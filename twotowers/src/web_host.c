#include <emscripten/wasmfs.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int create_parent_directories(char *path)
{
    for (char *part = path + 1; (part = strchr(part, '/')); ++part) {
        *part = '\0';
        int result = mkdir(path, 0755);
        *part = '/';
        if (result < 0 && errno != EEXIST)
            return -1;
    }
    return 0;
}

static int mount_partitions(void)
{
    backend_t backend = wasmfs_create_fetch_backend("/partitions", 64 * 1024);
    if (!backend || wasmfs_create_directory("/virtual_disk", 0755, backend) < 0)
        return -1;
    for (int partition = 1; partition <= 5; ++partition) {
        char path[40];
        snprintf(path, sizeof(path), "/virtual_disk/partition%d.img", partition);
        int fd = wasmfs_create_file(path, S_IRUSR | S_IWUSR, backend);
        if (fd < 0)
            return -1;
        close(fd);
    }
    return 0;
}

int tt_web_mount_disc(void)
{
    FILE *manifest = fopen("/disc-manifest", "r");
    if (!manifest)
        return -1;

    int result = -1;
    backend_t disc = wasmfs_create_fetch_backend("/disc", 256 * 1024);
    if (!disc || wasmfs_create_directory("/game_files", 0755, disc) < 0)
        goto done;

    char path[1024];
    static const char prefix[] = "/game_files/";
    memcpy(path, prefix, sizeof(prefix));
    char *entry = path + sizeof(prefix) - 1;
    while (fgets(entry, sizeof(path) - (size_t)(entry - path), manifest)) {
        char *newline = strchr(entry, '\n');
        if (!newline)
            goto done;
        *newline = '\0';
        if (create_parent_directories(path) < 0)
            goto done;
        int fd = wasmfs_create_file(path, S_IRUSR, disc);
        if (fd < 0)
            goto done;
        close(fd);
    }
    result = ferror(manifest) ? -1 : mount_partitions();

done:
    fclose(manifest);
    return result;
}
