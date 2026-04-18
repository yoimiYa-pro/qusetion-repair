# CentOS / 宝塔：`npm install` 失败（Node 18、better-sqlite3、C++20）

你遇到的日志里同时有三类问题，需要**按顺序**处理。

---

## 1. Node 版本必须是 20+（必做）

日志里 `better-sqlite3@12`、`find-my-way`、`vite` 等都要求 **Node ≥ 20**，当前 **v18.20.8** 不满足。

**宝塔**：「软件商店」→ **Node 版本管理器** → 安装 **20.x LTS**（如 20.19.x），在网站或 SSH 环境里选用该版本。

**或 nvm**（SSH）：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v   # 应显示 v20.x
```

项目根目录已提供 **`.nvmrc`**（内容为 `20`），进入目录后可执行：`nvm use`。

---

## 2. GCC 不支持 `-std=c++20`（编译 better-sqlite3 失败）

`g++: error: unrecognized command line option '-std=c++20'` 表示系统自带的 **g++ 过旧**（CentOS 8 常见），本机编译 `better-sqlite3` 需要 **GCC 10+**（建议 11）。

**CentOS 8 / RHEL 8** 使用 GCC Toolset 11：

```bash
sudo dnf install -y gcc-toolset-11-gcc gcc-toolset-11-gcc-c++ make python3
# 仅在当前 shell 启用新编译器后再 npm install
scl enable gcc-toolset-11 bash
gcc --version
cd /www/wwwroot/qusetion-repair
rm -rf node_modules
npm install
```

若未装 `scl`，先：`sudo dnf install -y scl-utils`。

**Rocky / Alma 9** 一般自带较新 gcc，可先 `dnf install gcc gcc-c++ make` 再试。

---

## 3. `prebuild-install` 连 GitHub 超时（ETIMEDOUT）

若已满足 Node 20 + 新 GCC，多数会优先下载**预编译二进制**，不再本地编。

仍超时可：

- 换网络或稍后重试 `npm install`；
- 服务器配置 HTTP 代理后重试；
- 在能访问 GitHub 的机器上 `npm install` 打包 `node_modules` 再上传（不推荐，仅应急）。

---

## 4. Conda（base）把 `python` 指到 3.13（可选排查）

若 `node-gyp` 使用 **Miniconda 的 Python 3.13** 出现异常，可临时指定系统 Python：

```bash
npm config set python /usr/bin/python3
# 安装完可恢复：npm config delete python
```

或在**非 conda 环境**的纯 SSH 会话里执行 `npm install`。

---

## 5. 安装成功后

```bash
cd /www/wwwroot/qusetion-repair
npm run build
```

子路径前端见仓库内 `deploy/nginx-subpath-baota.example.conf`，后端用 PM2 跑 `apps/server/dist/index.js`。

### 5.1 宝塔站点与 `git pull`

- 若 **`git pull` 提示 `package-lock.json` 本地修改将被覆盖**：在服务器上一般应**丢弃**对 lockfile 的本地改动（勿把面板里手改的 lock 当真相），执行：
  - `git checkout -- package-lock.json`（仅恢复该文件），再 `git pull`；或 `git stash -u` 后 `git pull`，确认无冲突后再 `git stash drop`。
- 宝塔可能在 **`apps/web/dist/.user.ini`** 写入防跨站配置；旧版 Vite 清空 `dist` 时可能报 **`ENOTDIR ... .user.ini`**。仓库已在 **`npm run build -w @qusetion-repair/web`** 前自动执行 `scripts/clean-dist.mjs` 并关闭 `emptyOutDir`，保留 `.user.ini` 并删除其余构建产物后再打包。若仍失败，检查该文件是否被 `chattr +i` 锁定：`lsattr apps/web/dist/.user.ini`。

---

## 自检清单

| 检查项 | 命令 / 期望 |
|--------|-------------|
| Node | `node -v` → **v20.x** |
| 编译器 | `scl enable gcc-toolset-11 -- gcc -v` 或 `gcc -v` → **≥10** |
| 再装依赖 | 项目根目录 `rm -rf node_modules && npm install` |

若执行完仍报错，把**完整** `npm install` 末尾 30 行贴出（含 `gyp ERR!` 与 `make` 第一处 error）。
