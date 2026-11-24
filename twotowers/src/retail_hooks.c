#include <stddef.h>
#include <stdint.h>
#include <string.h>

#if !defined(_WIN32)
#include <strings.h>
#define _strnicmp strncasecmp
#endif

/* Preserve the call contracts of mixed guest wrappers while removing the
 * feature implementations. Neutral results leave the retail paths in charge. */

/* Achievement events. */
void tt_ach_unlock(const char *id)
{
    (void)id;
}

void tt_ach_file(const char *xp)
{
    (void)xp;
}

void tt_ach_vs_round(int win, int hp, int maxhp, int taken)
{
    (void)win;
    (void)hp;
    (void)maxhp;
    (void)taken;
}

void tt_ach_vs_match(const char *skin, int shield_mode)
{
    (void)skin;
    (void)shield_mode;
}

void tt_ach_vs_event(int kind, int who, int a, int b, const char *skin)
{
    (void)kind;
    (void)who;
    (void)a;
    (void)b;
    (void)skin;
}

void tt_ach_vs_match_ex(int who, const char *skin, const char *other, int goal, int lost, int troll, int arena)
{
    (void)who;
    (void)skin;
    (void)other;
    (void)goal;
    (void)lost;
    (void)troll;
    (void)arena;
}

void tt_ach_vs_round_ex(int who, unsigned ms, int troll)
{
    (void)who;
    (void)ms;
    (void)troll;
}

void tt_ach_vs_hit(int who, int dmg, int ranged, const char *skin, int troll)
{
    (void)who;
    (void)dmg;
    (void)ranged;
    (void)skin;
    (void)troll;
}

void tt_ach_vs_foe_kill(int who)
{
    (void)who;
}

void tt_ach_vs_scores(int s1, int s2)
{
    (void)s1;
    (void)s2;
}

void tt_ach_ffa_match(int who, int lost, int kills, int troll, int players)
{
    (void)who;
    (void)lost;
    (void)kills;
    (void)troll;
    (void)players;
}

void tt_ach_tdm_match(int team, int lost)
{
    (void)team;
    (void)lost;
}

/* Online session state. */
int tt_net_on(void)
{
    return 0;
}

int tt_net_me(void)
{
    return 0;
}

int tt_net_players(void)
{
    return 0;
}

int tt_net_active(void)
{
    return 0;
}

uint32_t tt_net_entry(void)
{
    return 0;
}

void tt_net_init(void)
{
}

int tt_net_chat_open(void)
{
    return 0;
}

float tt_net_step_dt(void)
{
    return 0;
}

void tt_net_step(void)
{
}

void tt_net_hash(uint32_t h)
{
    (void)h;
}

void tt_net_votes(int *restart, int *quit, int *menus)
{
    *restart = 0;
    *quit = 0;
    *menus = 0;
}

int tt_net_menu_is_open(void)
{
    return 0;
}

int tt_net_lobby_state(void)
{
    return 0;
}

int tt_net_lobby_ready(void)
{
    return 0;
}

void tt_net_lobby_toggle_ready(void)
{
}

int tt_net_joiner_waiting(void)
{
    return 0;
}

int tt_net_coop_flow(void)
{
    return 0;
}

int tt_net_lobby_page_wanted(void)
{
    return 0;
}

void tt_net_lobby_host(void)
{
}

void tt_net_lobby_join(void)
{
}

void tt_net_lobby_leave(void)
{
}

const char * tt_net_lobby_label(int row)
{
    (void)row;
    return "";
}

void tt_net_lobby_value(int row, char *out, int n)
{
    (void)row;
    if (n > 0) out[0] = '\0';
}

int tt_net_lobby_change(int row, int d)
{
    (void)row;
    (void)d;
    return 0;
}

void tt_net_lobby_type_port(int c)
{
    (void)c;
}

void tt_net_lobby_type(int c)
{
    (void)c;
}

void tt_net_lobby_status(char *out, int n)
{
    if (n > 0) out[0] = '\0';
}

int tt_net_lobby_start(void)
{
    return 0;
}

void tt_net_p2_upg_send(int hb, const uint8_t *rec, const uint8_t *blk)
{
    (void)hb;
    (void)rec;
    (void)blk;
}

void tt_net_post_wait(void)
{
}

void tt_net_relaunch_vote(int what)
{
    (void)what;
}

/* Versus audio and records. */
void tt_vs_play_mode_wav(const char *name, float vol)
{
    (void)name;
    (void)vol;
}

int tt_troll_record(int kind, long v, int who)
{
    (void)kind;
    (void)v;
    (void)who;
    return 0;
}

long tt_troll_record_get(int kind, const char **who, const char **when)
{
    (void)kind;
    (void)who;
    (void)when;
    return 0;
}

void tt_vs_play_wav(const char *name, float vol)
{
    (void)name;
    (void)vol;
}

int tt_vs_play_ring(void)
{
    return 0;
}

const char * tt_vs_music_track_for_stream(const char *stream)
{
    (void)stream;
    return "";
}

int tt_vs_hero_sound(const char *skin, uint32_t id, float vol)
{
    (void)skin;
    (void)id;
    (void)vol;
    return 0;
}

int tt_vs_foe_sound(uint32_t id, float vol)
{
    (void)id;
    (void)vol;
    return 0;
}

int tt_vs_bank_sound(const char *bank, uint32_t id, float vol)
{
    (void)bank;
    (void)id;
    (void)vol;
    return 0;
}

int tt_vs_voice(const char *who, int slot, float vol)
{
    (void)who;
    (void)slot;
    (void)vol;
    return 0;
}

/* Port UI still uses the Xbox font for its existing English labels. */
int tt_tr16(const char *text, uint16_t *out, int max)
{
    int n = 0;
    if (max <= 0) return 0;
    if (text)
        while (n < max - 1 && text[n]) {
            out[n] = (uint8_t)text[n];
            n++;
        }
    out[n] = 0;
    return n;
}

int tt_tr16n(const char *text, uint16_t *out, int max)
{
    return tt_tr16(text, out, max);
}

int tt_tr16s(const char *text, const char *value, uint16_t *out, int max)
{
    int n = 0;
    if (max <= 0) return 0;
    for (; text && *text && n < max - 1; text++) {
        if (strncmp(text, "{1}", 3) == 0) {
            for (int i = 0; value && value[i] && i < 47 && n < max - 1; i++)
                out[n++] = (uint8_t)value[i];
            text += 2;
        } else {
            out[n++] = (uint8_t)*text;
        }
    }
    out[n] = 0;
    return n;
}

const char *tt_trL(const char *text)
{
    return text;
}

int tt_lang_on(void)
{
    return 0;
}

const char *tt_lang_code(void)
{
    return "en";
}

int tt_lang_key16(uint32_t key, const uint16_t **out)
{
    (void)key;
    (void)out;
    return -1;
}

uint32_t tt_lang_startup_size(void)
{
    return 0;
}

int tt_lang_line(uint32_t first, uint32_t end, uint32_t *new_first, uint32_t *new_end)
{
    (void)first;
    (void)end;
    (void)new_first;
    (void)new_end;
    return 0;
}

void tt_lang_line_back(void)
{
}

/* Preserve the per-level reset, including the solo Fangorn cutscene fix.
 * The file hook always falls through to the disc path. */
static const char *observe_disc_file(const char *path)
{
    const char prefix[] = "\\Device\\CdRom0\\Worlds\\";
    if (_strnicmp(path, prefix, sizeof(prefix) - 1) == 0) {
        extern void coop_level_reset(void);
        coop_level_reset();
    }
    return NULL;
}

void tt_retail_file_hooks_init(void)
{
    extern const char *(*xbox_path_redirect)(const char *path);
    xbox_path_redirect = observe_disc_file;
}
