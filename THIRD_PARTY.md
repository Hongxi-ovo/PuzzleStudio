# 第三方内容与资源来源

编辑器的界面、工程模型和导入导出实现重新编写，没有使用旧版 PuzzleMaker 的代码或界面素材。参考项目为 [mycard/ygopro-PuzzleMaker](https://github.com/mycard/ygopro-PuzzleMaker)。

随源码保留的第三方组件和资源：

| 内容 | 来源与说明 |
| --- | --- |
| luaparse | [fstirlitz/luaparse](https://github.com/fstirlitz/luaparse)，原 MIT 许可见 [luaparse.LICENSE](Tools/PuzzleEditor/web/vendor/luaparse.LICENSE) |
| 数据库与卡片 Lua 脚本快照 | 当前 MDPro3 开发工作区，主项目来源为 [MDPro3](https://code.moenext.com/sherry_chaos/MDPro3)；脚本中的作者及版权声明保留在 `scripts.zip` |
| 默认完整卡图 | 来自 [YGOMobile](https://github.com/fallenstardust/YGOMobile-cn-ko-en) 的 `mobile/assets/data/pics.zip`，并合入开发工作区的完整扩展卡图；该项目原许可文件见 [YGOMobile-LICENSE](licenses/YGOMobile-LICENSE) |
| 卡背 | 开发者提供的 YGOPro 卡背图片 |
| 高清卡图 | 运行时通过 YGOMobile 所用图源按需获取，存入用户本地缓存 |

资源文件的数量、大小和 SHA-256 记录在 [manifest.json](Tools/PuzzleEditor/resources/manifest.json)。第三方卡面、卡片文本和脚本的原有权利及声明不因本仓库的发布而改变。

Windows 便携包另含 Python、pywebview、pythonnet、PyInstaller 及相关依赖；包内 `licenses/` 保留所收集的许可文件，`build-info.json` 记录依赖版本。
