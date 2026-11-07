# 语音助手（Windows 候选 0.1.3）

DSH 原生会话负责模型、工具、权限和聊天记录；共用 SDK 负责语音循环；PC 服务壳负责麦克风、扬声器、字幕和托盘。可选 Web UI 只显示状态和提交命令，关闭页面不会停止已明确开启的语音。

从 DSH 侧栏打开“语音助手”即可使用文字管理。默认预填可编辑的大肥鱼 / DeepSeek 娘人设，沿用 DSH 原生默认模型与预设。设置中配置识别、播报服务和音色、保存密钥、选择设备并测试，再点击“开启语音”。停止语音不取消已受理的原生任务；用户开口打断播报时，文字继续保留。

语音密钥由 DSH 原生凭据存储持有，按接口地址绑定，只回显配置状态。改变服务地址后需要为新地址保存密钥。普通设置保存在 DSH settings。设备/服务切换先释放旧设备；清理未确认时禁止重新占用。

独立字幕支持字号、透明度、皮肤、拖拽、调整大小和锁定；托盘提供暂停、静音、显示/隐藏字幕、解锁和停止入口。多屏变化时字幕会回到可见工作区。

桌宠适配支持 `dsh-pet 0.4.5-fork.3` 的显示租约协议。安装兼容版本后，在设置中选择具体桌宠，并分别控制气泡和动画；右键“开始聊天”打开同一个助手 GUI，不启动第二个会话或语音循环。未加载兼容服务时设置保持不可用，显示已加载版本或缺失原因。桌宠候选的发布、安装和视觉验收状态另见验收记录。

## 固定版本安装预检

先使用独立 Home、profile 和端口安装固定 Git 提交，验证后再进入正式实例的空闲切换窗口。保留 profile 清单、锁文件与配置恢复点；仅使用官方插件安装器，不覆盖 node_modules。

Windows 进程组使用精确依赖 `koffi@3.1.1`。pnpm 若返回 `ERR_PNPM_IGNORED_BUILDS`，先核对包版本及其原生模块安装脚本，再在目标 profile 的 `pnpm-workspace.yaml` 合并精确许可：

```yaml
allowBuilds:
  'koffi@3.1.1': true
```

保留既有策略，禁止通配放行全部构建脚本；重跑原官方安装命令并验证 Koffi 在实际 Host 运行时可加载。仅配置许可不代表安装或设备验收成功。与桌宠组合安装时还需核对其固定 Git 来源构建许可，以及实际加载的显示租约协议和包版本。

## 构建

设置 `DSH_SHARED_ASSISTANT_ROOT` 指向共享 SDK 0.11.0，`DSH_DESKTOP_SERVICE_ROOT` 指向 PC 服务壳，执行 `npm run build`。构建记录输入文件 SHA256 到 `sdk-snapshot.json` 与 `dist/build-info.json`，复制随包音频 runtime。宿主需提供现有 Electron；默认使用当前 DSH Home 下的 electron，可在进阶设置指定路径。本插件不下载模型或改开机启动。

当前构建期依赖 esbuild、zod、schemastery，生产依赖 Koffi。DSH 公开服务由 profile 提供，不将另一份 DSH Core 打入插件。旧浏览器音频 owner 已从候选入口与源码移除。

## 支持与验收

实际接入五个原生管理工具：查询会话、搜索、读取状态、等待结果、向已有会话发送/继续任务。发送有持久请求身份；已受理和已完成分开，不自动重发未确认任务。工具范围可限制到助手工作目录，编辑人设不会改动工具权限。

完整系统提示词模式的 preset 不允许通过本界面替换人设，会明确提示。普通 scoped persona preset 的替换、工具保留、全局隔离与卸载恢复已通过真实 DSH 合同验证。

详见 [候选验收](RESIDENT_ACCEPTANCE.md)。源码/构建测试通过不等于已经安装或完成真实麦克风、声学打断、字幕视觉和默认模型工具验收。Rabi 适配、远端工具、眼镜、原生实时语音模型另行接入。

0.1.2 修复官方存储域名校验导致的 Host 导入失败：持久域使用 `voice_assistant`，HTTP 地址和插件名不变。旧域名无法通过官方 `defineDomain`，不会生成可迁移存储。设置 `VOICE_TEST_DSH_PROFILE` 为独立安装 profile，执行 `npm run test:host-contract`，直接加载该插件实际 peer 依赖与本地构建产物，并验证真实存储域关闭重开；仅测试介质使用内存。该检查不替代完整宿主和声学验收。

0.1.3 修复 Settings 仅公开 ACTIVE 插件导致的初始化时序循环。启动和运行读取 Loader 注入的 volatile Config（`get()`），写回仍使用实际 entry id、官方 Settings 和 revision；初始化失败也释放已打开的存储域。完整 Loader 测试需同时设置 `VOICE_TEST_DSH_CORE` 为与独立 profile 匹配且已构建的 Core 源码目录，再运行 `npm run test:host-contract`。测试运行真实 Loader、Settings、ConfigEditor、存储域和完整插件 apply，覆盖历史配置、热更新、持久化、卸载重启及中途失败恢复；传输、凭据、模型端口和存储介质是测试替身，不代表网络或声学验收。
