# Egern Scripts

自用 Egern 模块与小组件合集。

## 组件

| 组件 | 功能 | 导入 |
| --- | --- | --- |
| 服务器监控 | 通过 SSH 查看 CPU、内存、磁盘、网络与温度，支持密码或私钥登录 | [server-monitor.yaml](https://raw.githubusercontent.com/ddkpp9/egern-scripts/main/modules/server-monitor.yaml) |
| 网络出口状态 | 显示直连/代理公网 IPv4、IPv6、地理位置和 Wi-Fi/蜂窝内网 IPv4 | [network-ip-widget.yaml](https://raw.githubusercontent.com/ddkpp9/egern-scripts/main/modules/network-ip-widget.yaml) |
| 湖北联通 | 显示剩余话费、流量和语音，接口失败时使用缓存 | [hubei-unicom.yaml](https://raw.githubusercontent.com/ddkpp9/egern-scripts/main/modules/hubei-unicom.yaml) |
| 今日黄历 | 真实宜忌、冲煞、农历、节气和彭祖百忌，每天北京时间 0 点更新 | [almanac-widget.yaml](https://raw.githubusercontent.com/ddkpp9/egern-scripts/main/modules/almanac-widget.yaml) |

点击 Raw 链接后在 Egern 中导入模块。

## 湖北联通配置

- `AUTHORIZATION`：必填，由你自行抓包获取完整请求头值。
- `PACKAGE_IDS`：可选，多个 `FEE_POLICY_ID` 用逗号分隔；留空时统计全部套餐。
- `REFRESH_MINUTES`：可选，默认 15 分钟，可选 5、15、30、60、1440（24 小时）。

使用的接口：

- `POST https://wap.10010hb.net/zinfo/front/user/findFeePackage`
- `POST https://wap.10010hb.net/zinfo/front/user/findLeftPackage`

脚本不会自动抓取、上传或写入仓库任何认证信息。`AUTHORIZATION` 仅保存在 Egern 的模块环境配置中。

## 说明

- 所有组件使用同一套中性主题，并通过 Egern 的 `{ light, dark }` 动态颜色自动跟随 iOS 深色模式。
- 网络出口状态在 Wi-Fi/蜂窝网络变化时预取数据；iOS 仍负责决定小组件实际重绘时间。
- 中国大陆 IPv4 的省市归属优先使用 IPIP.NET 免费接口，结果缓存 24 小时；IPv6 和境外 IP 使用原有接口。
- 网络出口状态仅显示内网 IPv4；代理出口没有 IPv6 时自动隐藏 IPv6 行。
- 服务器监控的私钥必须包含完整的 `BEGIN/END` 内容；支持真实换行或 `\\n`。
- 今日黄历使用 TimelessQ 万年历接口；同一天所有尺寸和手动刷新共用一次缓存，只在北京时间日期变化后重新请求，不会生成随机宜忌或幸运指数。

## 致谢

- 服务器监控基于 [egerndaddy/quick-start](https://github.com/egerndaddy/quick-start) 修改。
- 湖北联通接口与数据结构参考 [Honye/scripting-scripts](https://github.com/Honye/scripting-scripts/tree/main/scripts/%E6%B9%96%E5%8C%97%E8%81%94%E9%80%9A)。
