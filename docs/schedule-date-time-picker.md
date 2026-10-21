# 单次定时任务的执行时间选择器

需求 #1962（admin 截图 6207.jpg）。`ScheduleEditor` 的单次计划使用现有 `TaskDuePicker`：点字段打开月历，选择日期并输入时、分、秒，确定后更新表单；取消不改草稿。桌面用贴字段弹层，触屏用底部面板。

- `requireTime` 模式不显示全天或日期-only快捷项，提交必须是具体时刻；原有任务期限选择器默认行为不变。
- 字段明确为设备本地时间；选择结果转换为UTC瞬间，仍走原有创建/编辑接口，不改变计划时区和周期执行语义。
- 空值仍为空，不自动创建执行时间。已有计划回填保留秒，复制顺延与过去时间提示保留。
- 本次不修改每日/每周的时间输入、优先级或错过执行策略，不增加原生依赖。

定向验证：`schedule-date-time.test.ts`、`due-time.test.ts`、`schedule-editor-model.test.ts`；另执行 `npm run typecheck` 和 Expo web export。构建/测试不代表线上或手机原生交互验收。
