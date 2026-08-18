# LexiBridge 4

手机与电脑通用的中英德法四语词汇学习 PWA。目标词库为 10,000 个不重复英语学习词元，默认从第 2,501 位开始，减少已有基础词造成的时间浪费。

## 功能

- English → 中文语义确认 → Deutsch / Français 对照
- 到期复习优先于新词，四档自适应间隔
- 每日新词量、复习上限、学习起点、掌握条件可调
- 10,000 词分层：核心 / 中高级 / 学术扩展 / 高级拓展
- 四语搜索、系统朗读、学习统计、7 天复习预测
- 本机保存进度；完整 JSON 备份可导出/导入
- PWA：首次完整加载后可由 Service Worker 离线使用

## 词库构建

`scripts/build_vocab.py` 可重复构建 10,000 张完整四语卡。英语概念骨架来自 OMW English WordNet；中文、法语、德语优先使用 Chinese Open Wordnet、WOLF、OdeNet 的跨词网概念对齐。缺失语言才使用公开的 word2word 双语语料词典补足。FrequencyWords 只作为常用度排序信号，不把字幕频率直接视为学术重要度。

自动构建必须同时满足：10,000 张卡、10,000 个唯一英语头词、每张卡四语字段齐全；否则工作流失败而不会发布部分词库。

注意：自动对齐卡不等同于四位母语编辑逐条出版级审校；程序界面对此不作虚假声明。长期可继续把高价值词逐批升级为人工精修卡。

## GitHub Pages

发布源使用 `main` 分支根目录。仓库 Settings → Pages → **Deploy from a branch** → `main` → `/(root)`。

正常发布地址：`https://grokX97.github.io/lexibridge4/`

## 开放数据

- Open English WordNet / Global WordNet Association
- Open German WordNet (OdeNet)
- WOLF (Wordnet Libre du Français)
- Chinese Open Wordnet
- FrequencyWords / OpenSubtitles frequency lists
- word2word bilingual lexicons（仅缺口回退）

各上游数据保留各自许可证与署名要求；本仓库代码与数据内容的再分发需同时遵守对应上游许可证。
