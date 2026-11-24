#include <windows.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "gfx_menu.h"
#include "tt_env.h"

extern ptrdiff_t xbox_GetMemoryOffset(void);
extern void (*volatile xbox_tex_observer)(uint32_t hash, uint32_t *argb, int w, int h);
extern volatile long xbox_tex_rev;
extern FILE *tt_exe_fopen(const char *rel);
extern void tt_dbg(const char *fmt, ...);

#define G16(a) (*(volatile uint16_t *)(xbox_GetMemoryOffset() + (uint32_t)(a)))

#include "prompts.inc"

void tt_prompts_init(void)
{
    xbox_tex_observer = prompts_tex;
}
