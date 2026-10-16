// @ 选 Agent — run: bun src/mention-menu.test.ts
import { mentionCandidates, mentionMenuOpen, mentionQuery } from "./mention-menu";

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = "") => {
  total++;
  if (cond) { pass++; console.log("✅", name); }
  else console.log("❌", name, extra);
};

ck("普通消息不开", mentionQuery("你好") === null && !mentionMenuOpen("你好"));
ck("转义的 @ 不开", mentionQuery("\\@通信牛") === null);
ck("空 @ 打开", mentionQuery("@") === "");
ck("有空格就关，避免挡正文", mentionQuery("@通信牛 在吗") === null);
ck("按别名过滤", mentionCandidates("@通信", [{ alias: "通信牛" }, { alias: "通信欧" }, { alias: "TMAI欧" }]).map(x => x.alias).join(",") === "通信牛,通信欧");
ck("选中只填草稿", mentionCandidates("@牛", [{ alias: "通信牛", online: true }])[0].insert === "@通信牛 ");
ck("在线的排前面", mentionCandidates("@", [{ alias: "乙", online: false }, { alias: "甲", online: true }])[0].alias === "甲");
ck("同名只留一条", mentionCandidates("@", [{ alias: "通信牛" }, { alias: "通信牛" }]).length === 1);
ck("空别名不出现", mentionCandidates("@", [{ alias: "  " }]).length === 0);

console.log(`${pass}/${total}`);
if (pass !== total) process.exit(1);
