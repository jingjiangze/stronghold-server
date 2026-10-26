# mods

把数据 mod 放在这里，每个 mod 一个文件夹（里面有 `pack.json`），然后重启服务器。服务器开服时读一次，启动日志会列出每个 mod 是否加载、问题和冲突；玩家打开页面时从服务器取得同一份 mod。

也可以用环境变量 `AUE_MODS_DIR` 或启动参数 `--mods <文件夹>` 指定别的文件夹。

mod 的写法、检查和试跑见引擎仓库的 [docs/mods.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/main/docs/mods.md)。

这个文件夹里除了本说明，其他文件不进 git。
