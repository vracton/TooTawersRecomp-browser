#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <limits>
#include <map>
#include <emscripten/wasmfs.h>
#include <unistd.h>

#include "memory_backend.h"
#include "wasmfs.h"

namespace {
constexpr off_t pageSize = 4096;
using Page = std::array<uint8_t, pageSize>;

class SparsePartition final : public wasmfs::DataFile {
public:
    SparsePartition(mode_t mode, wasmfs::backend_t backend) : DataFile(mode, backend) {}

    int open(wasmfs::oflags_t) override { return 0; }
    int close() override { return 0; }
    int flush() override { return 0; }
    off_t getSize() override { return size; }

    int setSize(off_t next) override
    {
        if (next < 0)
            return -EINVAL;
        if (next < size) {
            auto firstDiscard = pages.lower_bound(next / pageSize + (next % pageSize != 0));
            pages.erase(firstDiscard, pages.end());
            if (next % pageSize != 0) {
                auto last = pages.find(next / pageSize);
                if (last != pages.end())
                    std::fill(last->second.begin() + next % pageSize, last->second.end(), 0);
            }
        }
        size = next;
        return 0;
    }

    ssize_t read(uint8_t *buffer, size_t length, off_t offset) override
    {
        if (offset < 0)
            return -EINVAL;
        if (offset >= size)
            return 0;
        length = std::min<off_t>(length, size - offset);
        for (size_t done = 0; done < length;) {
            const off_t position = offset + done;
            const size_t index = position % pageSize;
            const size_t count = std::min(length - done, static_cast<size_t>(pageSize) - index);
            const auto page = pages.find(position / pageSize);
            if (page == pages.end())
                std::memset(buffer + done, 0, count);
            else
                std::memcpy(buffer + done, page->second.data() + index, count);
            done += count;
        }
        return length;
    }

    ssize_t write(const uint8_t *buffer, size_t length, off_t offset) override
    {
        if (offset < 0 || length > static_cast<uint64_t>(std::numeric_limits<off_t>::max() - offset))
            return -EINVAL;
        for (size_t done = 0; done < length;) {
            const off_t position = offset + done;
            const size_t index = position % pageSize;
            const size_t count = std::min(length - done, static_cast<size_t>(pageSize) - index);
            const uint8_t *source = buffer + done;
            const off_t pageIndex = position / pageSize;
            if (std::all_of(source, source + count, [](uint8_t byte) { return byte == 0; })) {
                auto entry = pages.find(pageIndex);
                if (entry != pages.end()) {
                    auto &page = entry->second;
                    std::fill_n(page.begin() + index, count, 0);
                    if (std::all_of(page.begin(), page.end(), [](uint8_t byte) { return byte == 0; }))
                        pages.erase(entry);
                }
            } else {
                auto &page = pages[pageIndex];
                std::memcpy(page.data() + index, source, count);
            }
            done += count;
        }
        if (length)
            size = std::max(size, offset + static_cast<off_t>(length));
        return length;
    }

private:
    off_t size = 0;
    std::map<off_t, Page> pages;
};

class PartitionBackend final : public wasmfs::Backend {
    std::shared_ptr<wasmfs::DataFile> createFile(mode_t mode) override
    {
        return std::make_shared<SparsePartition>(mode, this);
    }

    std::shared_ptr<wasmfs::Directory> createDirectory(mode_t mode) override
    {
        return std::make_shared<wasmfs::MemoryDirectory>(mode, this);
    }

    std::shared_ptr<wasmfs::Symlink> createSymlink(std::string target) override
    {
        return std::make_shared<wasmfs::MemorySymlink>(std::move(target), this);
    }
};
}

extern "C" int tt_web_mount_partitions(void)
{
    static constexpr off_t sectors[] = {0x465400, 0xFA000, 0x177000, 0x177000, 0x177000};
    auto backend = reinterpret_cast<backend_t>(
        wasmfs::wasmFS.addBackend(std::make_unique<PartitionBackend>()));
    if (wasmfs_create_directory("/virtual_disk", 0755, backend) < 0)
        return -1;
    for (unsigned index = 0; index < std::size(sectors); ++index) {
        char path[40];
        std::snprintf(path, sizeof(path), "/virtual_disk/partition%u.img", index + 1);
        const int fd = wasmfs_create_file(path, S_IRUSR | S_IWUSR, backend);
        if (fd < 0)
            return -1;
        const int result = ftruncate(fd, sectors[index] * 512);
        close(fd);
        if (result < 0)
            return -1;
    }
    return 0;
}
