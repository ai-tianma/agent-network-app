// / 候选菜单(#1050 第一片)— run: bun src/slash-menu.test.ts
import { slashCandidates, slashMenuOpen, slashQuery, moveSlashIndex, slashGroupLabel } from "./slash-menu";
import type { SkillSummary } from "./node-skills";

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = "") => {
  total++;
  if (cond) { pass++; console.log("✅", name); }
  else console.log("❌", name, extra);
};

const skill = (name: string, description = ""): SkillSummary => ({
  name, scope: "project", path_rel: "", description,
});

ck("普通消息不开菜单", slashQuery("你好") === null && !slashMenuOpen("你好"));
ck("转义的 / 不开菜单", slashQuery("\\/btw") === null);
ck("行首空格后的 / 仍算命令", slashQuery("  /btw") === "btw");
ck("已经有空格就关掉，避免挡普通输入", slashQuery("/btw 问题") === null);
ck("空 / 列出命令", slashCandidates("/", []).some(item => item.label === "/btw"));
ck("按名字过滤技能", slashCandidates("/rel", [skill("release-notes", "发版")]).some(item => item.insert === "/release-notes "));
ck("按描述过滤", slashCandidates("/发版", [skill("release-notes", "发版说明")]).length === 1);
ck("不匹配就没有技能行", slashCandidates("/zzz", [skill("release-notes", "发版")]).every(item => item.group !== "skill"));
ck("同名技能只留一条", slashCandidates("/", [skill("a", "1"), skill("a", "2")]).filter(item => item.group === "skill").length === 1);
ck("选中只填草稿，不发送", slashCandidates("/bt", []).every(item => item.insert.endsWith(" ") && !item.insert.includes("\n")));
ck("分组标题", slashGroupLabel("command") === "ANet 命令" && slashGroupLabel("skill") === "节点技能");
ck("上下键在列表里循环", moveSlashIndex(0, 3, "up") === 2 && moveSlashIndex(2, 3, "down") === 0);
ck("空列表不越界", moveSlashIndex(4, 0, "down") === 0);

console.log(`${pass}/${total}`);
if (pass !== total) process.exit(1);
