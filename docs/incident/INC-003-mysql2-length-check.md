# INC-003 mysql2 单行结果判空写法错误，发货接口恒定拒绝

| 项 | 内容 |
| --- | --- |
| 编号 | INC-003 |
| 日期 | 2026-10 中旬 |
| 等级 | P2（核心流程不可用） |
| 影响面 | `POST /api/order/ship` 卖家发货，100% 失败 |
| 状态 | 已修复 |

## 现象

卖家点击"发货"，接口返回订单不存在或无权操作。
但直接查库，订单明确存在、状态为已付款、`seller_id` 也确实是当前用户。

接口不是偶发失败，是**每次都失败**，与数据无关。

## 排查过程

1. 用同一 `order_id` 手工执行接口里的那条查询，返回 1 行数据 → 数据没问题。
2. 在判空分支前后加日志，打印实际取到的值：

```
row = { id: 12, status: 1, seller_id: 3, ... }
row.length = undefined
```

3. 定位到判空写法：

```js
const [row] = await query('SELECT ... WHERE id = ?', [orderId]);
if (!row.length) return res.status(404).json({ msg: '订单不存在' });
```

## 根因

`query()` 这一层已经把 `mysql2` 的 `[rows, fields]` 拆开，只返回 `rows`。
- 对 `SELECT` 多行查询，`rows` 是**数组**，用 `.length` 判空正确；
- 但当代码用 `const [row] = ...` 解构出**单行对象**后，`row` 是对象，
  对象没有 `length` 属性，`row.length` 恒为 `undefined`；
- `!undefined === true`，于是无论查没查到，都判定为"不存在"。

一个恒真的条件，伪装成了业务校验。

## 修复

区分两种情况，写成明确的两种判空：

```js
// 多行：判数组长度
const rows = await query('SELECT ...');
if (rows.length === 0) { /* 无数据 */ }

// 单行：判对象本身
const [row] = await query('SELECT ... WHERE id = ?', [id]);
if (!row) { /* 无数据 */ }
```

修复后发货流程正常，订单状态由已付款流转到已发货。

## 预防

- 同类问题在项目里全文检索了一遍 `.length` 的使用位置，逐处确认类型；
- 抽出 `getOne(sql, params)` 辅助函数，内部统一 `return rows[0] || null`，
  让调用方只能拿到 `null` 或对象，从源头消掉这种写法；
- 代码评审时把"判空表达式与实际类型是否匹配"列为固定检查项。

## 经验

> 这类 bug 最迷惑人的地方在于：**它不报错**。
> 没有异常、没有日志，只是逻辑悄悄地永远走 false 分支。
> 遇到"某功能恒失败且与数据无关"，优先怀疑恒真/恒假的条件表达式，而不是数据。
