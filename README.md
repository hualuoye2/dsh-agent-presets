> **独立发布版**：本仓库从个人 DSH 工作区 `D:\deepseek` 抽离，只包含版本控制白名单里的源码与文档；
> 模型、音频、凭据、构建产物与机器数据未包含。文中 `D:\deepseek\...` 路径按本仓库根目录理解。
>
# `.agent-presets/` — 目录用途

这里是 **agent preset 的源文件与全部校验/探针脚本**。

> ⚠️ **源在这里，但生效的不在这里。**
> preset 真正被挂载的位置是 `C:\Users\<you>\.dsh\.agent-presets\<id>\`
> —— **工作区外、不在版本控制内**。改了这里的源文件后**必须重新拷入**
> 并做 SHA256 比对，否则会"库里改了、运行时没变"。
> 完整配方与四个已踩过的坑见 skill **`verify-agent-presets`**。
>
> ```powershell
> # 先问「库里改了、运行时没变吗」——只读，什么都不写；有漂移 exit 1
> powershell -NoProfile -ExecutionPolicy Bypass -File .agent-presets\sync-presets.ps1 -DryRun
>
> # 真同步：只拷「缺失或哈希不同」的文件，一致的文件连 mtime 都不碰；修完 exit 0
> powershell -NoProfile -ExecutionPolicy Bypass -File .agent-presets\sync-presets.ps1
> ```
>
> 📌 **别只看退出码**：写入模式把漂移修好之后**也是 exit 0**，所以判"有没有漂移"要用
> `-DryRun`（工作区台账 `exitcode-vs-reason`）。拷完的判据是**重新读盘逐文件比 SHA256**，
> 不是"命令没报错"——脚本会打印 `WROTE copied=N landed=N`，`landed < copied` 就打
> `!! COPY DID NOT LAND`；进程级失败一律 exit 2（`sync-presets-selftest.ps1`，37 条断言）。

---

## 两个 preset

| 目录 | 是什么 | 相对出厂 `standard` 的差异 |
| --- | --- | --- |
| `verify/` | 「独立验证」：只做判定的代理 | 减去**整个 delegation 组**（`subagent` / `subagent_fork` / `workflow` / `ralph` 全无），persona 换成验证者立场。实测 **37** 个工具（对照 `standard` 44，差集 7 = delegation 组） |
| `standard-128k/` | 「标准模式（128 KB 指令预算）」 | **逐字节相同**，只有 preset 内 `agent-instructions` 的 `maxBytes`：`65536` → `131072` |

两个都是**照抄出厂 `standard` 再动一处**（`copy()` + `standingKeyFor()` 是权威做法，
但它们要 `cordis` preset 的工具，`standard` 里没有）。改动必须用
`git diff --no-index` 证明"只动了该动的那一处"。

## `standard-128k` 的接线（重要）

工作区指令的字节预算**在 Web 平面归 preset 管**：`dsh-base` 那行 `agent-instructions`
被 `dsh-web-app` 用 `disabled: true` 关掉了，所以最终生效的是 preset 里那一行。

因此把 desktop 的**默认 preset** 指过去，是在
`C:\Users\<you>\.dsh\profiles\desktop\cordis.patch.yml` 里加一条 **id 定向覆盖**：

```yaml
- id: agent-presets
  name: "@deepseek-ai/dsh-agent-presets"
  config:
    default: standard-128k
```

⚠️ 三条硬约束（都由 `dsh-app-boot` 的 loader 代码实测确认）：

1. **必须 id 定向覆盖，不能 `- insert:`** —— web-app 已经 insert 过这个 id，
   再 insert 会 `duplicate loader entry id: agent-presets`，**启动直接炸**。
2. **`config` 是整体替换、不是深合并**（loader 里就是 `target[key] = value`）。
   合成后的 `agent-presets` 行**只有 `default` 一个键**，所以整体替换不会丢东西——
   但如果以后上游给它加了别的键，这条覆盖会把它们**抹掉**。
3. **id 匹配不到只是警告跳过，不会崩**（`patch: entry "X" not found`）；
   但**字段非法或文件不是顶层数组会 throw**。所以改完必须用真实 loader 验一遍。

### 验证这条接线（`--dump-config` 对 desktop 被拒，见下）

`dsh --profile desktop --dump-config` 会报
`profile "desktop" is managed exclusively by the Electron application`，
所以**无法从 CLI 读 desktop 的合成结果**。可用的替代判据：

```powershell
# 用真实 loader 解析同一个 patch 文件，看合成后的 agent-presets 行
dsh --profile web --patch "C:\Users\<you>\.dsh\profiles\desktop\cordis.patch.yml" --dump-config
#   -> exit 0、且 config: default: standard-128k
#   唯一预期警告：patch: entry "ui-settings-account" not found（web 没有那个 UI 行）

# 再让实例真的带补丁起来，问 roster 谁是默认
node .agent-presets/preset-list.mjs <token> standard-128k
```

## 字节预算的实测账（2026-10-06）

`maxBytes` 限的是**渲染后的整条基线**（用户全局 `AGENTS.md` + 项目链 + 框架文本），
不是某一个文件。框架开销**不是常数**：两次渲染分别实测 **293 B** 与 **393 B**
（截断通知自身的长度也会变），所以按 **~300–400 B** 估。

| preset | 预算 | 单文件实际可用 |
| --- | --- | --- |
| `standard`（出厂默认） | 65,536 | ≈ 65,143 – 65,243 |
| `standard-128k` | 131,072 | ≈ 130,600 – 130,700 |

超预算时的行为（`render` 的既定策略）：

- **先整个丢掉"最宽泛"的文件，最后才截断"最具体"的那个**；
- 截断**从尾部切**，并在 UTF-8 字符边界收住（不会切出半个汉字）；
- 渲染后字节数**绝不超 `maxBytes`**；
- 打一条 `Workspace instruction budget <N> bytes: …` 通知，**指名**省略/截断了谁；
- **不报错、不失败、退出码正常** —— 磁盘文件完整，只有模型看到的是被切过的版本。

### 对照实验（证明 128 KB 真的更大）

`budget-ab.mjs`：造一个 **88,046 字节**的 `AGENTS.md`（自带 `.git` 自成项目根，
使指令链只有它），头尾各放一个标记；同实例、同 cwd 建两个会话，**只差 preset**：
（夹具是可再生的测量夹具 `_budget-probe/`，`check-ignore` 已确认被第 48 行规则排除；重建步骤见
`check-64k-arm.mjs` 的注释。**改夹具就要重跑对照**——被测物换了版本，"内容变了"与"工具变了"又会分不清。）

| preset | 头标记（对照） | 尾标记 | 通知 |
| --- | --- | --- | --- |
| `standard` | YES | **NO** | `budget 65536 bytes: truncated AGENTS.md from 88046 to 65143 bytes` |
| `standard-128k` | YES | **YES** | （无） |

头标记两边都在，证明文件确实进了指令链 —— 所以尾标记的差异只能是预算造成的。
**RESULT: PASS。**
（上面这一臂是**故障对照**：它证明量具抓得住截断。要测**真实** AGENTS.md 有没有被截断，
用 `check-64k-arm.mjs`——实测 64,763 字节的文件在 `standard` 下尾针在、通知为 0。）

## 目录里的脚本

| 文件 | 作用 |
| --- | --- |
| `probe-discovery.mjs` | **权威离线健康检查**：调真实 `discoverPresets` / `compositionProblem`，自带对照与故障注入（假包名必须被报 broken） |
| `budget-ab.mjs` | 指令预算的 A/B 对照实验（大 `AGENTS.md` + 头尾标记 + 仅改 preset） |
| `preset-list.mjs` | 从运行中的实例读 roster，标出谁是默认（desktop 的 `--dump-config` 被拒时的替代判据） |
| `validate-preset.mjs` | 手搓静态校验（行集差、realm 键）；**权威性低于 `probe-discovery.mjs`**，只当第一道筛子 |
| `check-metadata.mjs` | `preset.yml` 的 BOM / UTF-8 / 往返检查 |
| `extract-tool-lists.mjs` | 从会话 dump 里数工具、验 persona；**内建计数断言**（`verify`=37 / `standard`=44，再漂会 FAIL） |
| `check-ledger-registration.mjs` | 查我的台账结论**是否真在自动对账范围内**（防止"绿灯盖在空集上"） |
| `register-my-ledger-entries.mjs` | 幂等地同时补台账条目与 AGENTS.md 的 marker（两半同进同出） |
| `web-verify.overlay.yml` | 把 web 实例的默认指向 `verify` 的 overlay（临时探针用，不改任何持久配置） |
| `headless-*.overlay.yml` | 已证伪的 headless 路线留档（**不要再用**：它根本不查 preset roster） |
| `ab-verdict-A-standard.md` | Arm A 的结论（在 Arm B 独立复核之前写下） |
| `audit-armB-writes.mjs` / `extract-armB.mjs` / `inspect-records.mjs` | Arm B 独立复核的证据审计 |

## 全量工具索引（磁盘实测 44 个 `.mjs` / `.ps1` / `.py`）

> ⚠️ 上面「目录里的脚本」那张表只覆盖 preset 相关的一小部分。**本表才是权威索引**。
>
> **磁盘实测（本次复核）：44 个脚本 = 32 现役 + 12 `(one-off)`。** 其中 40 个是本次索引
> 任务开始时就存在的；后 4 个是任务期间出现的：守卫 `check-tool-index.mjs`（本次新建）、
> `sync-presets.ps1`（**另一个并发代理**于 2026-10-07 01:57:02 写入，比本节第一次成稿晚
> **26 秒**——它当场被守卫点名 `MISSING from README.md` + `RESULT: FAIL` + `exit 1`，
> 等于一次**自然发生的故障注入**）、`inject-facts-assertions.mjs`（P2-1 扩容断言时新建），
> 以及 `sync-presets-selftest.ps1`（同一个并发代理的注入自测，**又一次被同一条守卫点名**——
> 这条闸门连续两次抓到真实漏登记，不是摆设）。
>
> ⚠️ **这个目录是移动靶**：有多个代理会并发往里写脚本，所以上面的数字只保证「守卫跑绿的
> 那一刻」；任何时刻都以守卫的实时输出为准。
>
> **本表由守卫脚本兜底**：磁盘上任何顶层 `.mjs`/`.ps1`/`.py` 若没出现在本文件里，
> 守卫会**逐个点名**并 `exit 1`；全部覆盖才打印 `RESULT: PASS` 且 `exit 0`。
>
> ```powershell
> node .agent-presets/check-tool-index.mjs
> ```

### `(one-off)` 列的含义与判据

`(one-off)` = **它回答的是一个已经定论的一次性问题**（或目标产物已交付），留着只为让当时的
结论**可复核**；没有任何现役流程会调用它。判据按优先级，且**只看内容和注释、不看文件名**：

1. **头部注释自述目标问题已作答**，或**自述已被同目录更新的脚本取代**（并比对 mtime）；
2. **输入是已删除的会话 dump**（gitignored 的 `_*.json`）：重跑必须先按 recipe 重建输入，
   说明它服务的是当时那一次探针；
3. **同一批取证里被更晚的脚本取代**（mtime 相邻 + 新脚本头部点名取代关系）。

反之，**通用、参数化、会随环境变化再次需要**的脚本**不算** one-off —— 即使它们当初也是为
某一次争议而写。

**判定依据举例（4 个，都能现场复验）**：

| 文件 | 判 one-off 的依据 |
| --- | --- |
| `deep-check.mjs` | mtime `2026-10-07 00:52`，而 `struct-check.mjs` 是 `00:54` —— **2 分钟后**写的同行归属检查，且带区分性注入验证（把 `tool-subagent` 注入**另一行**，`CONTAINS` 仍为 false）。问题的更好答案出现后，旧的那个就是取证留档 |
| `extract-armB.mjs` / `audit-armB-writes.mjs` / `inspect-records.mjs` | 三者头部都写明输入 `_armB_page.json` / `_page-verify.json` **不在版本控制内**（`_*.json` 被 gitignore，探针结束后已删），`inspect-records.mjs` 全文只做「记录形状」探查。重跑要先整轮重建探针 ⇒ 服务的是 Arm B 那一次复核 |
| `session-preset-scan.mjs` | 头部**自己写着**「Supersedes …」的反面：它只认 `session.v4.jsonl.zstd`、漏了 v3 会话，而 `session-scan-all.mjs` 头部明写 supersedes 它并用 `session\.v(\d+)` 通配版本号。有取代者 ⇒ one-off |
| `session-instructions-scan-all.mjs` | 它的截断判据是 `/instruction budget\|truncated/i` 全串关键词匹配，而 `session-instructions.mjs` 头部记录了这条判据的**假阳性**（匹配到 AGENTS.md 自己的文档正文），改成锚定形状 + 与磁盘文件算术互证 ⇒ 旧量具作废，仅留档 |

### 索引表

| 文件 | 作用 | 何时用 | 是否 one-off |
| --- | --- | --- | --- |
| `probe-discovery.mjs` | **权威离线健康检查**：调真实 `discoverPresets` / `scanRoot` / `compositionProblem`，自带 `standard` 对照 + 假包名注入 | 做/改 preset **一律先跑它** | 现役 |
| `validate-preset.mjs` | 无运行时的静态校验 C1–C6（YAML 方言、包可解析、行集差、realm 键…），并**明写它判不了什么** | 新写 preset 的第一道筛子；**权威性低于 `probe-discovery.mjs`** | 现役 |
| `check-metadata.mjs` | 读**字节**查 preset 元数据：UTF-8 BOM、U+FFFD、`description` 里的 ASCII「冒号+空格」 | 新建/改动 `verify/preset.yml`、`agent.cordis.yml` 之后 | 现役 |
| `preset-list.mjs` | 从运行中的实例读 preset roster 并标出谁是默认 | desktop 的 `--dump-config` 被拒时的替代判据 | 现役 |
| `budget-ab.mjs` | 指令字节预算 A/B：造 88,046 字节 `AGENTS.md` + 头尾标记，同实例只差 preset | 要证明 128 KB 真的多送内容；也是 `check-64k-arm.mjs` 的**故障对照** | 现役 |
| `default-preset-test.mjs` | 不传 `agentPreset` 建会话，验证合成后的 `config.default` 真能决定 preset | 改了 profile patch 里的 `default:` 之后（补前一个 A/B 的漏洞） | 现役 |
| `extract-tool-lists.mjs` | 从会话 dump 数工具、验 persona，**内建计数断言**（`verify`=37 / `standard`=44） | 每次真实挂载校验后；输入缺失会**可操作地**报错让你先重跑探针 | 现役 |
| `check-verify-persona.mjs` | 把会话日志里模型**实收**的 persona 与 preset 文本按归一化段落序列逐段比对 | 改了 desktop `preset-verify` 的 persona，要验最后一跳没丢段落 | 现役 |
| `make-verify-row.mjs` | 从桌面 `preset-standard` 行生成 `preset-verify` 行：改 id/order、persona **逐字**抽取、整块删 delegation 组 | verify preset 的 persona 或工具集变化后重新生成该行 | 现役 |
| `make-128k-row.mjs` | 从桌面构建自己的 `standard` 行生成 `standard-128k` 行（整份 `config.plugins` + 只改一个数字） | 桌面 `standard.patch.yml` 变化（如升级 DSH）后重新生成 | 现役 |
| `install-preset-row.mjs` | **通用**安装器：把任意 preset 行装进活的 desktop patch（生产解析器 + 时间戳备份 + 装后复验 + 拒绝重复 id） | 任何时候往 desktop 加/换一行 preset | 现役 |
| `install-128k-row.mjs` | 专用安装器：只装 `preset-standard-128k` 这一行 | 取证期：已被同目录稍晚的通用形式 `install-preset-row.mjs` 取代 | `(one-off)` |
| `sync-presets.ps1` | 把**目录式 preset** 从入库的源树同步到真正生效的运行时副本（`%USERPROFILE%\.dsh\.agent-presets\`），并对两侧**逐文件 SHA256** 比对；`-DryRun` 只报告不写，`-Mirror` 才删目标多出的项；退出码 0=全一致 / 1=有差异 / 2=参数或读写失败 | 改完 `.agent-presets/<id>/` 里的源文件之后（治本文件开头那条「库里改了、运行时没变」）。**纯 ASCII、无 BOM**，只写 `<Dest>\<id>\` | 现役 |
| `sync-presets-selftest.ps1` | `sync-presets.ps1` 的**故障注入自测**：自建临时源/目标对（**绝不碰真实运行时目录**），注入 7 类故障并断言**退出码 + 磁盘字节**；哈希用 **certutil** 独立测量——与被测脚本内部的 `Get-FileHash` **不是同一个引擎**，所以不会继承被测对象的缺陷。实测 **37 passed / 0 failed**、exit 0 | **改动 `sync-presets.ps1` 之后必跑**（本工作区要求新检查器用注入证明自己，不许只凭"跑出来没问题"） | 现役 |
| `struct-check.mjs` | 生产 loader 解析补丁，回答**某一行**的 `config.plugins` 里还有没有目标 id（**同时**打印行内与全文件两个数） | 核「某行是不是真的删掉了 X」这类**归属**问题；已做区分性注入验证 | 现役 |
| `deep-check.mjs` | 生产 loader 解析补丁，判断某行 `config.plugins` 在**任意嵌套深度**下是否含目标 id | 取证期：2 分钟后被 `struct-check.mjs` 取代 | `(one-off)` |
| `inject.mjs` | 故障注入器：写**修改过的副本**（从不碰源），每种模式都断言自己的改动落地 | 给 preset/补丁检查器做注入验证时 | 现役 |
| `inject-facts-better-sidebar.mjs` | 为 `desktop_plugins`/`desktop_bundles` 两条断言造 3 份注入副本（含 NO-DOC 用例） | 取证期：2026-10-07 随 `dsh-better-sidebar` 登记一次性加入 | `(one-off)` |
| `inject-facts-assertions.mjs` | 给**全部 8 条**有注入用例的断言各造一份「数字被改坏」的副本（配合 `facts-check --doc`），并**自证注入落地**（目标串恰好出现 1 次） | **新增或修改 `facts-check` 断言之后必须跑**；HANDOFF P2-1 的判据就是"每新增一条先注入" | 现役 |
| `facts-collect.ps1` | 现场测量可测事实 → `_quarantine/facts-actual.json`（**纯 ASCII**：PS 5.1 按 ANSI 读无 BOM 的 UTF-8） | `facts-check.mjs` 之前；已由 `healthcheck.ps1` 第 6 段自动串起 | 现役 |
| `facts-check.mjs` | 把 AGENTS.md 的数字断言变可执行：锚点抠声称值 → 与实测 JSON 比对，`DRIFT`/`NO-DOC` 即 `exit 1` | 改了 AGENTS.md 数字、或被 healthcheck 自动调用 | 现役 |
| `agmd-audit.mjs` | AGENTS.md 事实审计：snapshot 基线 → compare，三层判定（字面存在 / 节绑定 / 行绑定）哪些断言消失 | 压缩或改写 AGENTS.md **之前**先 snapshot、之后 compare | 现役 |
| `splice-agmd.mjs` | 按 `## ` 节把替换文本拼进 AGENTS.md（标题必须**恰好**匹配一次；替换文本从文件读，避免转义踩坑） | 要成段替换 AGENTS.md 的某一节（配合 `agmd-audit.mjs`） | 现役 |
| `check-replacement.mjs` | **写盘前预检**：按闸门自己的数字正则，比对「某节基线里的数字 token」与候选替换文件，缺哪个当场打印 | 要替换 AGENTS.md 的某一节时——**先跑它再 splice**（一次写盘会把整份文件重新注入会话，写错很贵；本例它一次抓出漏掉的 `03`/`2`） | 现役 |
| `section-facts.mjs` | 打印**某一节**压着哪些数字 token（基线的 `bySection` 是 token→节序号 的映射） | 改写某节之前，先知道哪些数字原本绑在它身上（不查就只能猜） | 现役 |
| `check-64k-arm.mjs` | 在临时实例上以 preset `standard` 真建一个会话，判**真实 AGENTS.md** 有没有被 64 KB 预算截断：头针在 + **尾针在（§九 最后一节）** + 截断通知为 0 | 只在你要**证明老会话那一臂**时跑（新会话的红线是 128 KB，由 `facts-check` 的 `BUDGET=130700` 硬闸门管）；**不是每次改文件都必须跑** | 现役 |
| `verify-64k.ps1` | **上面那件事的一条命令形态**：起临时实例（独立端口）→ 取 token → 跑对照臂 + 真实臂 → 收尾杀实例并核对端口。退出码 **0**=两臂过且收尾已验证 / **1**=某一臂失败（内容判定）/ **2**=量具坏（端口被占、没拿到 token、夹具缺失、GUI 端口丢了） | 要复验 64 KB 臂时**首选这条**（手动四步最容易漏掉收尾）；纯 ASCII、无 BOM，参数 `-Port` 必须 19399（`budget-ab.mjs` 硬编码） | 现役 |
| `restore-probe-line.mjs` | 从改前备份**逐字节**取回被闸门误当命令的那一行（内部空格属于它的身份，手打必错） | 取证案例：`commands` 抽取把 `dsh root WRITE = NO …` 这类**输出**当成了命令 | `(one-off)` |
| `make-verify-handoff.mjs` | 生成交接包：一句话可证伪声明 + 复现方式 + 常备命令；`--uncertain` 时**故意不给命令** | 把结论交给 `verify` 会话前（skill `verify-by-subagent`） | 现役 |
| `check-ledger-registration.mjs` | 查我的台账结论是否真在自动对账范围内（防「绿灯盖在空集上」） | 改了 `assumption-ledger.jsonl` 或 `capmap.ps1` 的 `[LEDGER]` 段之后 | 现役 |
| `register-my-ledger-entries.mjs` | 幂等地同时补台账的 `author`+`docMarker` 与 AGENTS.md 的 `<!-- ledger:… -->`（两半同进同出） | 有结论只登记了一半时；硬编码我名下那 6 条 | 现役 |
| `session-tools.mjs` | 从会话自己的 `request/header` 读**实际挂载的工具集** + persona；给两个文件还能打 A/B 差集 | 判断「这个会话实际挂的是什么」（**别读会话头的 `agentPreset`**） | 现役 |
| `session-instructions.mjs` | 量一个会话**实收**多少字节工作区指令、有没有截断（锚定通知形状 + 与磁盘文件算术互证） | 判断指令预算是否生效（**不要看 preset 的名字**） | 现役 |
| `session-types.mjs` | 记录类型直方图 + 每种类型带哪些键 | 拿到陌生会话文件的第一步：先知道该问哪种记录 | 现役 |
| `session-dump.mjs` | 紧凑 dump 会话每条记录（类型 + 载荷切片），多帧全解 | 看一个会话文件里都有哪些记录 | 现役 |
| `session-record.mjs` | 打印某一种记录类型的原始 JSON（前 N 条 × 前 N 字符） | 已知记录类型、要看其中一条的完整结构 | 现役 |
| `session-needle.mjs` | 在会话文件里 grep 任意针（**逐帧**解压，不只看第一帧） | 会话里找一句话/一个标记；PS `Select-String` 读不了 zstd | 现役 |
| `session-scan-all.mjs` | 列磁盘上**全部**会话（v3 + v4 都认）及其记录的 preset | 按时间看 preset 分布（本文件取代 `session-preset-scan.mjs`） | 现役 |
| `session-preset-scan.mjs` | 报每个会话记录的 preset 分布与创建时间 | 取证期：自述已被 `session-scan-all.mjs` 取代（它漏了 v3 格式） | `(one-off)` |
| `session-frames-scan.mjs` | 解出**每一帧**并报 `agentPreset` 出现在哪几行 | 取证期：为回答「resume 会不会重解析 preset」而写，答案已定论 | `(one-off)` |
| `session-instructions-scan-all.mjs` | 扫全部会话，找谁含某段 AGENTS.md 正文并报实收字节 | 取证期：截断判据是后来被证伪的关键词式匹配 | `(one-off)` |
| `count-occ.mjs` | 独立出现次数计数器：大小写敏感/不敏感/宽松连字符三种计数 + 行号 | 任何「这个字符串出现几次」的争议；AGENTS.md §3.5 要求的两个互印证引擎之一 | 现役 |
| `asar-extract.mjs` | 按字节区间从 Electron `app.asar` 抠出单个成员文件原文（自带头部 pickle 布局断言） | 取证期：要读 `app.asar` 内某个文件（rg / PS 都读不进去） | `(one-off)` |
| `asar-grep.mjs` | 在 `app.asar` 里按字符串反查**它属于哪个成员文件**（成员名 + 上下文） | 取证期：定位某个字符串落在 app.asar 的哪个文件 | `(one-off)` |
| `asar-list.mjs` | 列 `app.asar` 内某目录的子项与字节数 | 取证期：定位桌面端解析树 `app.asar\dsh\node_modules\@deepseek-ai\` | `(one-off)` |
| `extract-armB.mjs` | 抽 Arm B 结论，并**先**审计它写/改了什么（会改被测物 ⇒ 自证无效） | 取证期：输入 `_armB_page.json` 已删 | `(one-off)` |
| `audit-armB-writes.mjs` | 审计 Arm B 到底**写了哪些文件**（`data.arguments` 是 JSON 字符串，必须解析后取 `file_path`） | 取证期：输入 `_armB_page.json` 已删 | `(one-off)` |
| `inspect-records.mjs` | 打印会话 page 记录的**形状**（类型 + 键 + ASCII 预览） | 取证期：输入 `_page-verify.json` 已删 | `(one-off)` |
| `check-tool-index.mjs` | **本索引的守卫**：磁盘脚本名集合 vs README 里出现的名字集合，磁盘有而 README 无 ⇒ 点名 + `exit 1` | 增删任何脚本、或改本 README 之后 | 现役 |

> 📌 **本目录里的 `asar-*.mjs` 是"唯一能读进 `app.asar`"的通路**：`app.asar\dsh\...`
> 对 `rg` 与 PowerShell 不可见（只有 Electron 打过补丁的 fs 能读），但它们**参数化、可复用**，
> 所以判 one-off 的依据是**当时那个取证问题已经定论**，不是"工具坏了"。

## 什么该入库

按根 `README`/`AGENTS.md` 的判据：**重写成本高的脚本与用途说明入库**，
**运行产物不入库**。因此：

- 入库：preset 源文件、上述脚本、本说明、overlay、结论记录。
- **不入库**：会话 dump（`.agent-presets/_*.json`、`_*.txt` 已在 `.gitignore` 里排除）、
  探针造的临时目录（如 `_budget-probe/`）。
