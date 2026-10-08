# Stock Management Tool (Excel)

Generates `output/Stock_Management_Tool.xlsx` from a warehouse export and answers:

1. Which city will face a shortage, and for which model (per brand)
2. Which city holds products that are not moving (per brand, per model)
3. Weeks of sales (WOS) per brand (nationally and per city)

Every number in the workbook is an Excel formula over the three input sheets
(`Inventory`, `Warehouse Tags`, `Sales 30 Days`) and the `Assumptions` sheet,
so quantities, the tag-to-city mapping and the thresholds can be changed in
Excel and everything recalculates.

## Input file

One workbook (see `input/wearhouse_inputs.xlsx`) with:

| Sheet | Layout |
|---|---|
| `Inventory` | system export: warehouse tags in row 2, product names in column A from row 5, quantity per tag |
| any sheet with "Tag" in its name | column A warehouse tag, column B city |
| any sheet with "Sales" in its name | column A product, column B quantity sold in the last 30 days |

Products are linked between sheets by the code inside `[ ]` in the product name.

## Build

```bash
python3 build_stock_tool.py input/wearhouse_inputs.xlsx output/Stock_Management_Tool.xlsx
```

Requires `openpyxl`. Open the output in Excel; it recalculates on open.
Re-run the script whenever new products or new warehouse columns are added,
because the formulas only cover the rows and columns present at build time.

## Output sheets

| Tab | Content |
|---|---|
| README | definitions, refresh steps, colour legend |
| Shortage Summary | city x brand matrices: models short / out of stock, units to transfer, models not moving, not-moving units, slow movers, WOS per brand per city |
| WOS by Brand | stock on hand, in transit, 30-day sales, weekly sales, WOS, sold-out and not-moving SKU counts per brand |
| Model Summary | per brand per model nationally, with the number of cities in shortage and not moving |
| City x Model | one row per model per city with stock, estimated demand, WOS, status and suggested transfer qty (filter by Status) |
| Assumptions | sales period, shortage / target-cover / slow-moving thresholds, minimum demand, city demand shares (overridable) |
| Inventory, Warehouse Tags, Sales 30 Days | inputs (paste new data here) |
| Product Master, Calc Map, Calc Keys | helper calculations |

## Key assumption

Sales are only known nationally. Each city's demand is estimated as national
model sales multiplied by the city's demand share, which defaults to the
city's share of stock on hand across selling cities. Override the share on
the `Assumptions` sheet if you have per-city sales. Warehouses in China and
Dubai (including transit) are treated as non-selling by default; change the
flag on `Warehouse Tags`.
