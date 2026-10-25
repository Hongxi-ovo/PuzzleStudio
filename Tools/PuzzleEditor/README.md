# 残局编辑器

独立本地工具，内置卡库、Lua 脚本、完整卡图及卡背。界面和编辑模型重新实现，没有使用旧 PuzzleMaker 的代码或素材。

## 启动

Windows EXE 0.2.1 位于 `Dist/PuzzleStudio-0.2.1/PuzzleStudio.exe`，完整便携包为 `Dist/PuzzleStudio-0.2.1-Windows-x64.zip`（约 325 MiB）。双击 EXE 即可，无需 Python 或 Node。0.2.1 修复了不能添加魔法、陷阱卡作为超量素材的问题。旧版仍保留在原目录。

本次已用打包后的 EXE 实际制作“演示残局-雷击与青眼”，在 MDPro3 1.4.8 定制版中载入，通过发动雷击、青眼白龙直接攻击取得 CLEAR。该验证记录来自原 MDPro3 开发工作区，个人桌面录屏与工程存档未上传到此仓库。

0.2.0 不再依赖外部 MDPro3 卡库或脚本。数据库快照、卡片与辅助 Lua、手机端默认完整卡图及卡背随程序携带。`--root "目录"` 与 `--choose-root` 只选择残局读写目录，该目录无需游戏资源。桌面运行需要系统 WebView2 与 .NET Framework 4.8。

独立窗口监听 `127.0.0.1:18744`，关闭窗口会停止服务。其自动存档与浏览器版分开，设置和日志放在 `%LOCALAPPDATA%/MDPro3/PuzzleStudio/`；可通过 JSON 工程或 Lua 导入现有场面。

### 从源码启动

双击本目录的 `Start.cmd`，或在仓库根目录运行：

```powershell
python Tools/PuzzleEditor/server.py --open
```

需要 Python 3.10+，没有第三方 Python 依赖。默认地址为 <http://127.0.0.1:18743/>；关闭服务终端即可停止。服务已经运行时直接刷新页面。

可用 `--root` 指定残局读写目录、`--port` 更换端口。当前内置简体中文卡库快照，运行时不叠加外部卡库或脚本。页面无需构建，前端依赖仅为附带 MIT 许可证的 luaparse。

### 重新打包

```powershell
./Tools/PuzzleEditor/Build-Windows.ps1
```

脚本在 `.local-setup/puzzle-studio/build-env` 创建独立构建环境，用 PyInstaller 将网页、Python、pywebview 和 resources 目录打入单个 EXE。桌面实现使用系统 WebView2，参见 [pywebview 打包说明](https://pywebview.flowrl.com/guide/freezing) 和 [PyInstaller 资源路径说明](https://pyinstaller.org/en/stable/runtime-information.html)。

打包后可运行 `PuzzleStudio.exe --check --report check.json` 检查冻结资源和导出，或 `--smoke-test --report renderer-check.json` 在临时独立配置下检查 WebView2 初始化，检查结束后自动退出。

## 编辑

- 点击场地空格选卡；支持搜索和拖动。两个 EX 格共用，放置时选择控制者。
- 拖动已放置的卡片靠近窗口底部，会弹出删除区；松开在删除区内即可删除，拖离或按 Esc 取消，Ctrl+Z 撤销。区域弹窗里的卡片同样支持。
- 点击双方各自的卡组、额外卡组、墓地、除外区，弹出已有卡片，可添加、编辑、删除和排序。卡组第一张为牌堆顶。
- 除外区和额外卡组可逐张设置表侧 / 里侧；双方除外区分别显示在各自墓地旁。
- 右侧「状态」设置表示形式、数值覆盖、原持有者、控制者、正规出场和召唤记录。召唤记录用于 `IsSummonType` 等效果判断，正规出场用于苏生限制，两项分别设置。
- 「效果」支持属性、种族、抗性、装备对象、永续对象、指示物和超量素材；「Lua」支持绑定到具体卡片的脚本片段。
- 超量素材支持怪兽、魔法和陷阱卡混合添加，保存工程与 Lua 导入导出保留素材卡种、持有者和宿主关系。
- 支持大师规则 3、2017 新大师规则、2020 修订规则，灵摆区和 EX 区按规则布局。
- 场地区域的对方卡片旋转 180 度，守备相对其正向逆时针旋转 90 度。翻面采用绕中心的 3D 旋转，里侧以卡背为底，正面按 0 → 70% → 0 线性渐显。系统开启减少动画时使用静态半透明提示。卡库及右侧预览保持正向，效果文本默认显示在预览图下方。
- 右侧底部提供独立的替换、复制到手牌、删除按钮，关闭工程位于顶部工具栏。关闭有修改的工程时选择「是 / 否 / 取消」；桌面版保存取消或失败时保留工程。
- 残局说明与开场提示逐行添加、删除。工程名使用可见输入框。
- 已移除 DIY 卡制作和扩展包生成；可读取游戏已有扩展卡，并为现有卡片编写残局内 Lua 效果。含旧版 DIY 定义的工程提示迁移，不静默丢弃数据。

## 完整卡图与缓存

所有卡图视图均使用完整卡面，按原始比例 contain 显示，不再使用 MDPro3 插画。场地格（含 EX、墓地、除外等）使用相同尺寸，场上的卡片统一尺寸并居中；守备仅旋转，不缩放或移位。

沿用本机 YGOMobile 的方式：先显示内置 `pics.zip` 的默认卡图；高清图通过 `https://cdn02.moecube.com:444/ygomobile-images/{卡号}.jpg` 异步获取，校验后原子写入 `%LOCALAPPDATA%/MDPro3/PuzzleStudio/CardImages/`，下次优先读取。并发限制为 3，同一卡号合并请求，失败保留内置图并延迟重试。下载完成后页面自动更新。卡背使用用户提供的 `cover.jpg`。

本次准备资源使用：

```powershell
python Tools/PuzzleEditor/freeze_resources.py --root "MDPro3目录" --mobile "YGOMobile源码目录" --cover "卡背图片路径"
```

此命令只准备内置资源，不生成 EXE。数据库与脚本来自当前 MDPro3，默认完整卡图来自手机端 `mobile/assets/data/pics.zip`，并合入扩展包中的完整卡图；快照文件、数量和 SHA-256 记录在 `resources/manifest.json`。普通启动只读取这些内置文件，游戏资源更新时需显式重新准备快照。

## 从卡片提取效果

选中怪兽区的怪兽，进入「效果 → 从卡片提取效果」。读取全部内置卡片脚本（资源准备时合并扩展覆盖内容），通过素材事件、超量素材效果和卡片文本发现候选，不使用卡号白名单。本机 14,163 份脚本筛出 503 张候选卡，可生成 107 种方案，包含 I:P 百变莱娜、复仇死者及其他融合、同调、连接、超量素材效果。

读取真实卡片脚本，通过 Lua AST 提取素材赋予函数中对接收者注册效果的代码及其依赖函数；保留目标限制、次数和重置条件。不会复制来源怪兽自身的其他效果或再次监听素材事件。来源脚本、摘要、SHA-256 和生成片段可以在弹窗中查看，片段快照保存在工程里。

此功能设置的是「开局已经获得的效果」。正常决斗中的赋予过程仍由原卡脚本处理。超量素材效果直接添加真实素材，保留取除素材等限制。依赖原素材实体、特殊事件上下文或外部辅助脚本的结构列入「需要手动处理」，可查看原文并自行编写 Lua。候选文本也可能描述自身获得效果，不能把所有候选都当作赋予其他怪兽的效果。

复仇死者这类原卡条件是以场上的对应怪兽作为仪式素材，赋予仪式怪兽效果；并非「每回合第一次仪式召唤」统一触发。可参考[官方之核卡片文本](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=13535&ope=2&request_locale=en)。

## 保存、导入和运行

- 工程 JSON 保存完整模型及脚本；浏览器自动保存最近工程，并支持撤销 / 重做。自动存档与手动保存分开记录修改状态。
- 「打开」可读取 `Puzzle/` 下的本地残局，或选择 Lua / JSON 文件。
- Lua 导入只做静态解析，不执行脚本；无法图形化解释的函数和语句保留原文。含自定义引用的场面可能限制删除或卡组重排，避免破坏原脚本绑定。
- 能独立识别的卡片效果会关联到原卡，在 Lua 页签默认显示并可修改，导出时在原位置替换。印卡示例会自动选中其额外卡组载体，并显示「印卡」标记；旧的浏览器存档也会补做识别。共享回调或动态绑定等不能安全分离的代码仍保留在完整原始脚本中。
- 「导出」预览并检查 Lua 语法，可下载 Lua、完整 ZIP，或写入当前 MDPro3。ZIP 包含工程和 `Puzzle/*.lua`。
- 写入 MDPro3 只创建新文件；同名时要求修改工程名。

## 检查

从仓库根目录运行。Python 单元测试可独立执行；原生检查另需 Node.js、Windows x64 Python 和 MDPro3 工作区，通过环境变量 `MDPRO3_ROOT` 指定其位置；会读取该工作区的 `Assets/Plugins/Windows/ocgcore.dll` 和残局文件。

```powershell
python Tools/PuzzleEditor/tests/native_compat.py --extra "示例残局.lua"
python Tools/PuzzleEditor/tests/native_features.py
python -m unittest discover -s Tools/PuzzleEditor/tests -p "test_*.py"
```

先运行 `native_compat.py` 生成卡库输入，再运行功能检查。机器报告写入仓库的 `.local-setup/puzzle-studio/`。覆盖范围及已知限制见 [COMPATIBILITY.md](COMPATIBILITY.md)。
