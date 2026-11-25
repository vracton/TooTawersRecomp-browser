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

extern int tt_web_mount_partitions(void);

int tt_web_mount_disc(void)
{
    FILE *manifest = fopen("/disc-manifest", "r");
    if (!manifest)
        return -1;

    int result = -1;
    backend_t disc = wasmfs_create_fetch_backend("/disc", 256 * 1024);
    if (!disc || wasmfs_create_directory("/game_files", 0755, disc) < 0)
        goto done;
    backend_t movies = wasmfs_create_fetch_backend("/disc/fmv", 1024 * 1024);
    if (!movies || wasmfs_create_directory("/game_files/fmv", 0755, movies) < 0)
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
        backend_t backend = strncmp(entry, "fmv/", 4) == 0 ? movies : disc;
        int fd = wasmfs_create_file(path, S_IRUSR, backend);
        if (fd < 0)
            goto done;
        close(fd);
    }
    result = ferror(manifest) ? -1 : tt_web_mount_partitions();

done:
    fclose(manifest);
    return result;
}
