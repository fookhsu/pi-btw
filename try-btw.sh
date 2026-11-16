#!/usr/bin/env bash
# BTW 插件试用器 —— 8 个 /btw 实现逐个试，互不冲突
#
# 用法:  ./try-btw.sh <变体>
#
#   dbachelder   pi-btw 0.8.1     ★旗舰（已装全局但资源已停用，用本脚本加载）
#   xzzpig       分叉增强版        思考显隐 Ctrl+T、可点击转录行
#   narumitw     UI 工作区版       全屏/左右分栏、F9 导入上下文、Mermaid（仅 TUI）
#   nguyen       RPC 多槽位版      9 slot 并行、Alt+1-9、成本统计
#   pify         只读克制版        只读工具、静默 --save、思考折叠
#   rpiv         严谨上下文版      compaction 后自动重建、跨 /new 存活
#   fradser      轻量子进程版      最近4条上下文、答案限长、footer 成本
#   pandi        最小实现          无工具、一次性、永不入 history
#
# 隔离原理：全局 settings.json 里 pi-btw 的 extensions/skills 已过滤为 []
# （装着但不加载），所以这里直接 -e 叠加即可，不会和任何变体抢 /btw。
# 你自己的其他包（搜索、subagents 等）在试用会话里照常可用。
#
# 试用结束想常驻某个:  pi remove npm:pi-btw && pi install npm:<包名>
# 恢复全局旗舰版:      把 settings.json 里 pi-btw 条目改回字符串 "npm:pi-btw"
set -e
case "${1:-help}" in
  dbachelder) exec pi -e npm:pi-btw ;;
  xzzpig)     exec pi -e npm:@xzzpig/pi-btw ;;
  narumitw)   exec pi -e npm:@narumitw/pi-btw ;;
  nguyen)     exec pi -e npm:@nguyenquangthai/pi-btw ;;
  pify)       exec pi -e npm:@pify/btw ;;
  rpiv)       exec pi -e npm:@juicesharp/rpiv-btw ;;
  fradser)    exec pi -e npm:@fradser/pi-btw ;;
  pandi)      exec pi -e npm:@pandi-coding-agent/btw ;;
  *) sed -n '2,22p' "$0"; exit 1 ;;
esac
