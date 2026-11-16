# Arm A 判据（standard preset，作者视角）—— 在启动 Arm B 之前写死

日期：2026-10-03
标的：AGENTS.md 第六节的一句话结论

> 2026-10 全量基线：**32 PASS / 2 环境性 FAIL**（`check_four_features`、`check_three_features`，
> 均为离屏渲染/写盘相关，**非新回归**）

问题：这句话对不对？那 2 个 FAIL 真的是环境问题吗？

**我（Arm A）的立场必须声明：我读过 AGENTS.md，已经被这句话锚定了。**
这正是需要独立验证者的场景。

---

## 判决

| 子命题 | 我的判定 | 依据（命令 + 原始输出） |
| --- | --- | --- |
| `check_four_features` 的 3 项失败是环境性（写盘） | ✅ **成立，且已实验证实** | 见下 |
| `check_three_features` 的 1 项失败是环境性（写盘） | ✅ **成立，已实测机制** | 见下 |
| 两者「非新回归」 | ✅ **成立** | 导出/保存代码在可写路径下均正常 |
| 那句话「均为写盘相关」是否**完整** | ❌ **不完整** | 它掩盖了一个假 PASS，见"新发现" |

### 证据 1：check_four_features —— 可证伪预言的实验

原位置：`28/31`，其中
```
[!!] PNG 导出
[!!] 整夜延时 GIF 导出　导出失败：[Errno 13] Permission denied: 'D:\\deepseek\\tools\\export_final.gif'
[!!] GIF 可读回　-1 帧
```
读脚本 L193/L197：输出路径 = `os.path.dirname(__file__)` = `D:\deepseek\tools\`。
L195 的消息是 `f"{size} MB" if isfile else ""` —— **文件不存在时消息就是空串**，所以 PNG 那条"没有原因"。

**预言**：若纯是写权限，把脚本挪到可写目录（`__file__` 的 dirname 变成可写、`..` 仍指向
`D:\deepseek` 以保持 `stellar_nexus` 可导入），输出跟着挪，就应当通过。

**实验**：复制到 `_quarantine\check_four_features_probe.py` 后运行 → **`31/31` 全通过**，
`PNG 5.94 MB`、`GIF 13 帧 0.91 MB`，两个文件确实落盘。
→ 3 项失败**全部**是写入位置问题，导出代码完好。**预言成立，解释被证实（不只是"合理"）。**

### 证据 2：check_three_features —— 受控对照

`save_horizon_profile` 的目标 = `os.path.join(app_dir(), "horizon_profile.json")`，
而 `app_dir()`（`核心\utils.py` L71）= `dirname(dirname(utils.py))` = **`D:\deepseek\stellar_nexus`**。

同解释器、同调用形状，只换目录：
```
D:\deepseek\stellar_nexus\horizon_profile.json  →  PermissionError [Errno 13]
D:\deepseek\_quarantine\horizon_probe.json      →  OK
```
→ 机制确证：写 `stellar_nexus\` 被拒（与 `tools\` 同族）。**注意：本会话文件策略已是
`danger-full-access`，仍然被拒** —— 印证 AGENTS.md「这不是普通 ACL 问题」。

### 新发现：一个被「环境性」标签掩盖的假 PASS

`保存地平剖面` 失败，但**紧邻的 `[OK] 重新载入一致　载回 6 点` 通过了**。
`load_horizon_profile()` 在文件不存在时返回空 profile（应为 0 点）。为何是 6 点？

因为目标文件**存在**，是 **2026-09-23** 写的陈旧产物，内容 `azimuths=[0,45,90,135,200,300]`
与检查自己画的 6 点**完全一致**：

```
D:\deepseek\stellar_nexus\horizon_profile.json   266 字节   2026/9/23 1:00:54
```

→ **那个 OK 是在读 10 天前的残留文件，不是在验证它刚保存的东西。**
写权限失败因此被**自己的陈旧产物掩盖**。`check_three_features` 报 22/23 看着只差一项，
实际上它有一项**不该算通过**。

---

## 我自己的一个错误（记录，因为同类错误在本工作区已犯 5 次）

第一版探针我写的是 `os.path.abspath("horizon_profile.json")`，按 **CWD** 解成
`D:\deepseek\horizon_profile.json` —— 一个**程序从不会用**的路径。拿它测出「写得进去」，
于是我的初判是「AGENTS.md 说写盘相关是**错的**」。

改调程序自己的 `app_dir()` 才拿到真路径。**我差点把自己的量具错误写成"文档错了"。**
教训：**要用被测程序自己的路径函数，别自己拼。**

---

## 交给 Arm B 的问题（与我自己回答的是同一个）

> `tools\check_three_features.py` 里唯一失败的那一项（`保存地平剖面`）——是环境问题，
> 还是真的代码回归？给出判定，附命令与原始输出。若你认为它被别的东西掩盖了，说出来。
