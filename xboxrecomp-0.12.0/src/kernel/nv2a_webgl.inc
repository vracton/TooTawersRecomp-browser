#include <emscripten/emscripten.h>
#include <emscripten/html5_webgl.h>

static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE web_context;
static int web_unpack_stride;
static int web_pack_stride;
static uint32_t *web_pixels;
static size_t web_pixel_capacity;
static void (APIENTRY *web_clear_depthf)(GLfloat);
static void (APIENTRY *web_draw_buffers)(GLsizei, const GLenum *);
static void (APIENTRY *web_draw_elements)(GLenum, GLsizei, GLenum, const void *);
static void (APIENTRY *web_pixel_store)(GLenum, GLint);
static void (APIENTRY *web_tex_image)(GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void *);
static void (APIENTRY *web_tex_sub_image)(GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, const void *);
static void (APIENTRY *web_read_pixels)(GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void *);

static uint32_t web_swap_red_blue(uint32_t pixel)
{
    return (pixel & 0xff00ff00u) | ((pixel & 0xffu) << 16) | ((pixel >> 16) & 0xffu);
}

static const uint32_t *web_upload_pixels(const void *source, int width, int height)
{
    if (!source)
        return NULL;
    size_t count = (size_t)width * height;
    if (count > web_pixel_capacity) {
        void *next = realloc(web_pixels, count * sizeof(*web_pixels));
        if (!next)
            return NULL;
        web_pixels = next;
        web_pixel_capacity = count;
    }
    int stride = web_unpack_stride ? web_unpack_stride : width;
    for (int y = 0; y < height; ++y) {
        const uint32_t *row = (const uint32_t *)source + (size_t)y * stride;
        uint32_t *dest = web_pixels + (size_t)y * width;
        for (int x = 0; x < width; ++x)
            dest[x] = web_swap_red_blue(row[x]);
    }
    return web_pixels;
}

static void APIENTRY web_set_pixel_store(GLenum parameter, GLint value)
{
    if (parameter == GL_PACK_ROW_LENGTH)
        web_pack_stride = value;
    else if (parameter == GL_UNPACK_ROW_LENGTH)
        web_unpack_stride = value;
    web_pixel_store(parameter, value);
}

static void APIENTRY web_upload_texture(GLenum target, GLint level, GLint internal, GLsizei width,
    GLsizei height, GLint border, GLenum format, GLenum type, const void *source)
{
    if (format != GL_BGRA) {
        web_tex_image(target, level, internal, width, height, border, format, type, source);
        return;
    }
    const uint32_t *pixels = web_upload_pixels(source, width, height);
    web_pixel_store(GL_UNPACK_ROW_LENGTH, 0);
    web_tex_image(target, level, internal, width, height, border, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    web_pixel_store(GL_UNPACK_ROW_LENGTH, web_unpack_stride);
}

static void APIENTRY web_update_texture(GLenum target, GLint level, GLint x, GLint y,
    GLsizei width, GLsizei height, GLenum format, GLenum type, const void *source)
{
    if (format != GL_BGRA) {
        web_tex_sub_image(target, level, x, y, width, height, format, type, source);
        return;
    }
    const uint32_t *pixels = web_upload_pixels(source, width, height);
    if (!pixels)
        return;
    web_pixel_store(GL_UNPACK_ROW_LENGTH, 0);
    web_tex_sub_image(target, level, x, y, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    web_pixel_store(GL_UNPACK_ROW_LENGTH, web_unpack_stride);
}

static void APIENTRY web_read_texture(GLint x, GLint y, GLsizei width, GLsizei height,
    GLenum format, GLenum type, void *dest)
{
    if (format != GL_BGRA) {
        web_read_pixels(x, y, width, height, format, type, dest);
        return;
    }
    web_read_pixels(x, y, width, height, GL_RGBA, GL_UNSIGNED_BYTE, dest);
    int stride = web_pack_stride ? web_pack_stride : width;
    for (int row = 0; row < height; ++row) {
        uint32_t *pixels = (uint32_t *)dest + (size_t)row * stride;
        for (int column = 0; column < width; ++column)
            pixels[column] = web_swap_red_blue(pixels[column]);
    }
}

static void APIENTRY web_select_draw_buffer(GLenum buffer)
{
    web_draw_buffers(1, &buffer);
}

static void APIENTRY web_clear_depth(GLdouble depth)
{
    web_clear_depthf((GLfloat)depth);
}

static void APIENTRY web_draw_base(GLenum mode, GLsizei count, GLenum type,
    const void *indices, GLint base)
{
    if (base == 0)
        web_draw_elements(mode, count, type, indices);
}

static int web_bind_context(void)
{
    EmscriptenWebGLContextAttributes attributes;
    emscripten_webgl_init_context_attributes(&attributes);
    attributes.majorVersion = 2;
    attributes.alpha = EM_FALSE;
    attributes.depth = EM_FALSE;
    attributes.stencil = EM_FALSE;
    attributes.antialias = EM_FALSE;
    attributes.explicitSwapControl = EM_TRUE;
    attributes.renderViaOffscreenBackBuffer = EM_TRUE;
    attributes.proxyContextToMainThread = EMSCRIPTEN_WEBGL_CONTEXT_PROXY_ALWAYS;
    web_context = emscripten_webgl_create_context("#gpu-canvas", &attributes);
    if (web_context > 0 && emscripten_webgl_make_context_current(web_context) == EMSCRIPTEN_RESULT_SUCCESS)
        return 1;
    fprintf(stderr, "  [GL] WebGL 2 context unavailable; using software rendering\n");
    return 0;
}
