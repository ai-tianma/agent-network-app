// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/lib/avatar-resolve.test.ts
// R1 avatar 解析链回归(通信龙 07-31 验收:双向 + 同一份数据里的正向对照)。
import { readFileSync } from 'node:fs';
import { planAvatarFile, poolFileNameForAlias, poolIndexForAlias, POOL_SIZE, KNOWN_BUNDLED_FILES, canEditAvatar, validateCustomAvatarUrl, isRelativeOrSameHub, isLegacyAvatarApiRoute } from './avatar-resolve';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const hub = (aliases: string[], map: Record<string, string> = {}) => ({ nodeAliases: new Set(aliases), map });

// 一份数据同时含 node-backed 和 session-only —— 满足"正向对照":两条腿都在同一测里
const NODE = 'grok测试7';   // 有 nodes 行
const SESS = '临时会话马';   // 纯会话(无 nodes 行)
const POOL_OF = (a: string) => `file:${poolFileNameForAlias(a)}`;

// ── 方向 A:node-backed 出 hub 图 ──────────────────────────────────────────────
ck('A1 node-backed + hub 绝对URL → remote', planAvatarFile(NODE, hub([NODE], { [NODE]: 'https://cdn.x/a.png' })) === 'remote:https://cdn.x/a.png');
ck('A2 node-backed + hub 相对池图 → 该文件(不是 alias 的池位)', planAvatarFile(NODE, hub([NODE], { [NODE]: '/avatars/avatar-09.webp' })) === 'file:avatar-09.webp');
ck('A3 相对URL带query/hash → 取 basename', planAvatarFile(NODE, hub([NODE], { [NODE]: '/avatars/avatar-03.webp?v=2#x' })) === 'file:avatar-03.webp');
ck('A4 http 大小写不敏感', planAvatarFile(NODE, hub([NODE], { [NODE]: 'HTTPS://cdn/x.png' })) === 'remote:HTTPS://cdn/x.png');

// ── 方向 B(🔴 正向对照):session-only 仍出池图 —— 删掉池层这条必挂 ─────────────
ck('B1 session-only(无 nodes 行)→ djb2 池图', planAvatarFile(SESS, hub([NODE], { [NODE]: 'https://cdn/x.png' })) === POOL_OF(SESS));
ck('B2 session-only 命名覆盖 → 命名文件', planAvatarFile('通信N站马', hub([])) === 'file:intern_avatar.png');
ck('B3 session-only 普通别名 → 池图(稳定)', planAvatarFile('随便一个马', hub([])) === POOL_OF('随便一个马'));

// ── 🔴 清空一致性(R2 加了本地缓存层后·这是真回归门)──────────────────────────────
// 关键:node-backed 已清空(在 nodeAliases·hub map 无值)时,即使**本地缓存里有旧值**,
// 也必须走设计默认链、**不能用本地缓存复活旧图**(网页 #75)。C1/C2 故意喂一个 stale 本地值,
// 若 planAvatarFile 对 node-backed 误读了 local,这两条立刻红——这就是"真测缓存路径、非恒真"。
const STALE_LOCAL = { [NODE]: '/avatars/avatar-05.webp' }; // 本地残留的旧图(≠ NODE 的 djb2 默认)
ck('C1 🔴 node-backed 已清空 + 本地有旧值 → 仍走设计默认(不复活 avatar-05)', planAvatarFile(NODE, hub([NODE], {}), STALE_LOCAL) === POOL_OF(NODE) && POOL_OF(NODE) !== 'file:avatar-05.webp');
ck('C2 🔴 node-backed 已清空:带 stale local == 不带 local(local 被跳过)', planAvatarFile(NODE, hub([NODE], {}), STALE_LOCAL) === planAvatarFile(NODE, hub([NODE], {})));
ck('C3 node-backed hub 有值 + 本地有不同值 → hub 全权(非本地)', planAvatarFile(NODE, hub([NODE], { [NODE]: 'https://cdn/hub.png' }), STALE_LOCAL) === 'remote:https://cdn/hub.png');
ck('C4 node-backed 命名覆盖 + 已清空 → 命名文件(设计默认含命名层)', planAvatarFile('通信N站马', hub(['通信N站马'], {}), { '通信N站马': '/avatars/avatar-05.webp' }) === 'file:intern_avatar.png');

// ── F:本地缓存层是 session-only 别名的唯一个性化层 ─────────────────────────────────
ck('F1 session-only + 本地绝对URL → remote(本地生效)', planAvatarFile(SESS, hub([]), { [SESS]: 'https://cdn/me.png' }) === 'remote:https://cdn/me.png');
ck('F2 session-only + 本地相对池图 → file(本地生效)', planAvatarFile(SESS, hub([]), { [SESS]: '/avatars/avatar-12.webp' }) === 'file:avatar-12.webp');
ck('F3 session-only + 无本地 → djb2 池图(不变)', planAvatarFile(SESS, hub([])) === POOL_OF(SESS) && planAvatarFile(SESS, hub([]), {}) === POOL_OF(SESS));
ck('F4 session-only 本地设了别人的别名·不串', planAvatarFile(SESS, hub([]), { '别的马': 'https://x/y.png' }) === POOL_OF(SESS));

// ── G:canEditAvatar —— 披露判据(node-backed 可编辑·session-only 不可)双向 ──────────
ck('G1 node-backed → 可编辑', canEditAvatar(NODE, hub([NODE])) === true);
ck('G2 session-only → 不可编辑(触发披露+禁用)', canEditAvatar(SESS, hub([NODE])) === false);
ck('G3 空 alias → 不可编辑', canEditAvatar('', hub([NODE])) === false && canEditAvatar(null, hub([NODE])) === false);

// ── H:validateCustomAvatarUrl —— 客户端预校验(镜像 hub #550·绝对 http(s))──────────
ck('H1 绝对 https 通过', (() => { const r = validateCustomAvatarUrl(' https://cdn/a.png '); return r.ok && r.url === 'https://cdn/a.png'; })());
ck('H2 相对路径拒(URL 字段只收绝对·相对走池选择器)', validateCustomAvatarUrl('/avatars/avatar-01.webp').ok === false);
ck('H3 空/空格/含凭据 拒', validateCustomAvatarUrl('').ok === false && validateCustomAvatarUrl('http://a b').ok === false && validateCustomAvatarUrl('https://u:p@h/x.png').ok === false);

// ── I: legacy avatar API route 只拦相对/同 Hub URL(Codex P2)────────────────────
ck('I1 同 Hub 的 /api/files 与 avatar 路由被识别', isRelativeOrSameHub('https://hub.example/api/files/x.png', 'https://hub.example') && isLegacyAvatarApiRoute('https://hub.example/api/files/x.png'));
ck('I2 相对路径算 Hub 路由,协议相对的不算', isRelativeOrSameHub('/api/files/x.png', 'https://hub.example') && !isRelativeOrSameHub('//evil.example/api/files/x.png', 'https://hub.example'));
ck('I3 外部 origin 的 API-like path 不误伤', !isRelativeOrSameHub('https://cdn.example/x/api/files/a.png', 'https://hub.example') && !isRelativeOrSameHub('https://cdn.example/api/users/u/avatar/v.png', 'https://hub.example'));
ck('I4 相对路径仍被识别为 avatar API route', isLegacyAvatarApiRoute('/api/files/f_1') && isLegacyAvatarApiRoute('/api/users/u/avatar/v.png'));
ck('I5 端口/协议不同的同主机不算同 Hub', !isRelativeOrSameHub('http://hub.example/api/files/x.png', 'https://hub.example') && !isRelativeOrSameHub('https://hub.example:8443/api/files/x.png', 'https://hub.example'));
ck('H4 file:// 等非 http(s) 拒(手机 ImagePicker 本地 URI 挡在这)', validateCustomAvatarUrl('file:///data/x.jpg').ok === false);

// ── set-but-unresolvable:node-backed 设了个 App 没打包的相对文件 → none(=pill·对齐网页 404) ──
ck('D1 node-backed 相对但未打包文件 → none(pill·不静默降级到池)', planAvatarFile(NODE, hub([NODE], { [NODE]: '/avatars/unknown-99.webp' })) === 'none');
ck('D2 node-backed 相对空串 → 视为清空 → 设计默认', planAvatarFile(NODE, hub([NODE], { [NODE]: '   ' })) === POOL_OF(NODE));

// ── 健壮 + djb2 契约 ──────────────────────────────────────────────────────────
ck('E1 空 alias → none', planAvatarFile('', hub([])) === 'none' && planAvatarFile(null, hub([])) === 'none' && planAvatarFile(undefined, hub([])) === 'none');
ck('E2 POOL_SIZE=20 且 KNOWN_BUNDLED_FILES 含全部池图+命名', POOL_SIZE === 20 && KNOWN_BUNDLED_FILES.has('avatar-20.webp') && KNOWN_BUNDLED_FILES.has('avatar-01.webp') && KNOWN_BUNDLED_FILES.has('intern_avatar.png'));
ck('E3 poolIndexForAlias 稳定 in [0,20)·同 alias 同值', (() => { const i = poolIndexForAlias(SESS); return i === poolIndexForAlias(SESS) && i >= 0 && i < 20; })());
ck('E4 poolFileNameForAlias 形如 avatar-NN.webp', /^avatar-\d{2}\.webp$/.test(poolFileNameForAlias(SESS)));
ck('E5 djb2 ≠ 恒定(不同 alias 能分到不同池位)', new Set(['a', 'bb', 'ccc', '马', 'grok'].map(poolIndexForAlias)).size > 1);

const renderer = readFileSync(new URL('../UserAvatarImage.tsx', import.meta.url), 'utf8');
ck('I6 渲染层只用 origin 判据拦 Hub 自有路由', renderer.includes('isRelativeOrSameHub(value, hubUrl)') && renderer.includes('isLegacyAvatarApiRoute(value)') && !renderer.includes("value.startsWith('/') || /\\/api/"));

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
