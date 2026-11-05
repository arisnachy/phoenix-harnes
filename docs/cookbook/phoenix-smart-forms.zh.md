# PHOENIX 智能表单与本地资料库

[English](phoenix-smart-forms.md) | 中文

原生生成式 UI 支持 smart_form（计算器、评估与问卷）和 smart_form_library（可重用定义）。模型在标记为 generative-ui 的 Markdown
代码块中输出声明式 JSON。计算无需执行任意 JavaScript，也无需网络请求。

## 最小 JSON 定义

~~~json
{
  "component":"smart_form","version":1,
  "props":{
    "id":"rectangle_area","title":"Rectangle area","kind":"calculator",
    "folder":"Science/Geometry","source":"Elementary geometry",
    "fields":[
      {"id":"width","label":"Width","type":"number","min":0.01,"unit":"cm"},
      {"id":"height","label":"Height","type":"number","min":0.01,"unit":"cm"}
    ],
    "outputs":[{
      "id":"area","label":"Area","unit":"cm²","precision":2,
      "expression":{"op":"mul","args":[{"field":"width"},{"field":"height"}]}
    }]
  }
}
~~~

## 支持的控件与表达式

- 类型：calculator、scientific、test、scale、survey、form。
- 输入：number、range、text、textarea、date、time、select、radio、checkbox。使用 showWhen 条件显示。
- 算术：add、sub、mul、div、pow、mod、min、max、abs、floor、ceil、round、neg。
- 科学：sqrt、ln、log10、exp、sin、cos、tan、pi。三角函数角度使用弧度。
- 逻辑：eq、neq、gt、gte、lt、lte、and、or、not、if。
- 日历天数：days_between、add_days。

表达式通过包含 op 和 args 的嵌套 JSON 对象，以及字段引用、常量或 today 定义。无效的数学输入返回明确错误，不会输出 Infinity 或 NaN。解析限制：最多 80
个字段、18 个输出、14 层嵌套、350 个表达式节点，并严格限制允许的属性。

## 资料库、历史版本与索引

- 通过 Save template 显式保存定义；选择逻辑目录，例如 Health/Obstetrics。
- 按名称、标识符、目录或标签搜索本地目录。同一 ID 的定义会增加版本号，最多保留十个历史版本。
- 点击 Improve with Kira，将当前定义作为草稿修改。修订需保留 ID，且由用户显式保存新版本。
- 保存答案和结果必须勾选同意选项。只有用户主动点击按钮，才能查看结果并将其提交给模型分析。
- 导入或导出带版本信息的 JSON 定义资料库。普通导出不包含答题历史。
- 点击 Share index with Kira 会将本地索引元数据填入可供用户确认的草稿；智能体不能自主发现浏览器本地模板。

内置示例包括成人 BMI、按末次月经日期推算孕周、科学计算及虚构的李克特量表问卷。这些仅作演示，不是经验证的临床工具。

## 持久化、隐私与未来集成

定义、目录标签、版本快照以及选择保存的答案仅通过 localStorage
保存在当前浏览器配置文件中。这不是操作系统目录、安全的临床记录、加密存储或跨设备同步。请勿存储患者身份标识或敏感医疗数据。

未来 Host 端资料库应提供受授权的 list/search/get/create/revise/run 工具，具备审计、访问控制、加密及可选的 FHIR Questionnaire 和
QuestionnaireResponse 交换。临床使用任何量表前都必须验证来源、版本、许可、适用人群和阈值。
