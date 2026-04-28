#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tina家 (tinanz.com) → nzbaobao.com 自动同步脚本

功能：
1. 从 tinanz.com 指定分类抓取商品
2. 自动分类（新西兰直邮 / 澳洲直邮）和定价
3. 导出为 CSV 或自动写入 Google Sheet（需配置 gspread）

使用方法：
  python sync.py --category 1026 --output csv
  python sync.py --category 1026 --output sheet --sheet-id YOUR_SHEET_ID
"""

import argparse
import csv
import json
import re
import sys
import time
from typing import List, Dict, Optional

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("请先安装依赖: pip install requests beautifulsoup4")
    sys.exit(1)


# ========== 配置 ==========

# 汇率配置（人民币 → 纽币/澳元）
# 请根据实际汇率和利润率调整
NZD_RATE = 0.25   # 1 RMB = 0.25 NZD (约 NZD/CNY 4.0)
AUD_RATE = 0.23   # 1 RMB = 0.23 AUD (约 AUD/CNY 4.35)

# 品牌分类映射
NZ_BRANDS = [
    'trilogy', 'comvita', 'streamland', 'caprilac', 'awa', 'encare',
    'mitoq', 'red seal', 'redwin', 'eco store', 'kiwigarden', 'hubbards',
    'vogel', 'weet-bix', 'sanitarium', 'whittakers', 'tasti', 'timtam',
    'knoppers', 'healtheries', 'edmonds', 'olivia', 'moccona', 'tangle teezer',
    'fresco', 'wyeth', 'oz care', 'oz farm', 'pediasure', 'ensure', 'glucerna',
    'karicare', 'bellamy', 'a2 platinum', 'a2 ', 'bellamy',
    'saviq', 'parrs', 'oasis sun', 'freezeframe', 'menino', 'linden leaves',
    'antipodes', 'royal nectar', 'km ', 'living nature', 'jurlique', 'savar',
    'isaac', 'epiology', 'alpine silk', 'organic care', "nature's beauty",
    "la'bonic", 'triumph', 'oneone', 'joy living', 'little beauties',
    'vivano', 'manuka secrets', 'ddmask', 'shadez', 'glow lab',
    'holistic hair', 'clinicians', 'milk & co', 'vida glow', 'essano',
    'lifemum', 'immunrise', 'syrene', 'ficce code', 'natio', 'foodfamily',
    'earthwise', "nature's way", 'bio balance', 'radiance', 'lifestream',
    'nutra life', 'good health', 'life space', 'artemis', 'childlife',
    'kidz minerals', 'harker', 'aspenridge', 'manuka', '蜜纽康', 'mgo',
    '新溪岛', '康维他', '蜡笔', 'gold kiwi', '花胶', '海参',
    'a2milk', 'a2 ', 'karicare goat', 'caprilac goat'
]

AU_BRANDS = [
    'blackmores', 'swisse', 'aptamil', 'healthy care', 'bio island',
    'ostelin', 'bio revive', 'thompson', 'bio balance', 'goat soap',
    'lucas papaw', 'restoria', 'femfresh', 'dermatix', 'refresh',
    'nu-lax', 'floradix', 'farex', 'rhinocort', 'morning fresh', 'moose',
    'mrs rogers', 'belle fleur', 'oral-b', 'heinz', 'tommee tippee',
    'watties', 'sukin', 'ego', 'beauteous', 'gm', 'eaoron',
    'thursday plantation', 'abeeco', 'moroccanoil', 'aveeno',
    'du it', 'bio oil', 'fatblaster', 'go healthy', 'puria', 'astasupreme',
    'haab', 'sudocrem', 'ypl', 'nuskin', 'detto', 'kelo-cote',
    'sheveu', 'saviq', 'parrs', 'menino', 'freezeframe',
    'antipodes', 'royal nectar', 'km口红', 'mgo', 'neurio', '纽瑞优',
    '爱他美', '澳佳宝', '斯维诗', '佳思敏', 'bio island', 'bio rev',
    'life space', 'thompson', 'radiance', 'goat soap',
    'lucas papaw', 'restoria', 'femfresh', 'refresh', 'floradix',
    'farex', 'rhinocort', 'sukin', 'ego', 'eaoron', 'thursday',
    'moroccanoil', 'aveeno', 'du it', 'bio oil', 'fatblaster',
    'go healthy', 'puria', 'astasupreme'
]

SKIP_KEYWORDS = ['礼品袋', '下单咨询', '才可以拍', '下单花胶']

HEADERS = ['id', 'name', 'price', 'original_price', 'image', 'origin', 'currency', 'sold', 'active']


# ========== 核心逻辑 ==========

def classify_product(name: str) -> tuple:
    """根据品牌名称判断产地和货币"""
    name_lower = name.lower()

    for brand in AU_BRANDS:
        if brand.lower() in name_lower:
            return '澳洲直邮', 'AU$'

    for brand in NZ_BRANDS:
        if brand.lower() in name_lower:
            return '新西兰直邮', 'NZ$'

    # 默认
    return '新西兰直邮', 'NZ$'


def should_skip(name: str) -> bool:
    for kw in SKIP_KEYWORDS:
        if kw in name:
            return True
    return False


def fetch_products(category_id: str, max_pages: int = 20) -> List[Dict]:
    """从 tinanz.com 抓取商品列表"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    products = []

    for page in range(1, max_pages + 1):
        url = f"https://www.tinanz.com/products/{category_id}?p={page}"
        try:
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code != 200 or len(resp.text) < 1000:
                break

            soup = BeautifulSoup(resp.text, 'html.parser')
            divs = soup.find_all('div', class_='items-gallery')
            if not divs:
                break

            for div in divs:
                name_tag = div.find('a', class_='entry-title')
                name = name_tag.get_text(strip=True) if name_tag else None
                href = name_tag.get('href') if name_tag else None

                price_tag = div.find('span', class_='price1')
                price_text = price_tag.get_text(strip=True) if price_tag else None

                img = div.find('img')
                img_src = img.get('src') if img else None
                if img_src and img_src.startswith('//'):
                    img_src = 'https:' + img_src

                if name and price_text:
                    match = re.search(r'￥(\d+)', price_text)
                    rmb_price = int(match.group(1)) if match else 0

                    wh_match = re.match(r'【([^】]+)】', name)
                    warehouse = wh_match.group(1) if wh_match else ''
                    clean_name = re.sub(r'【[^】]+】', '', name).strip()

                    products.append({
                        'name': clean_name,
                        'price_rmb': rmb_price,
                        'image': img_src or '',
                        'href': f"https://www.tinanz.com{href}" if href else '',
                        'warehouse': warehouse,
                    })

            print(f"  第 {page} 页: {len(divs)} 个商品")
            time.sleep(0.3)

        except Exception as e:
            print(f"  第 {page} 页出错: {e}")
            break

    print(f"\n共抓取 {len(products)} 个商品")
    return products


def convert_to_sheet_format(products: List[Dict], start_id: int = 9) -> List[List]:
    """转换为 Google Sheet Products 格式"""
    rows = []
    current_id = start_id

    for p in products:
        if should_skip(p['name']):
            continue

        origin, currency = classify_product(p['name'])
        rmb = p['price_rmb'] or 0

        if currency == 'NZ$':
            price = round(rmb * NZD_RATE, 2)
        else:
            price = round(rmb * AUD_RATE, 2)

        if price <= 0:
            continue

        rows.append([
            current_id,
            p['name'],
            price,
            '',           # original_price
            p['image'],
            origin,
            currency,
            0,            # sold
            'TRUE'        # active
        ])
        current_id += 1

    return rows


def export_csv(rows: List[List], filename: str):
    with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        writer.writerows(rows)
    print(f"\nCSV 已导出: {filename}")


def update_google_sheet(rows: List[List], sheet_id: str, creds_file: str):
    """使用 gspread 更新 Google Sheet（需提前配置 Service Account）"""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("请先安装 gspread: pip install gspread")
        return

    scopes = ['https://www.googleapis.com/auth/spreadsheets']
    creds = Credentials.from_service_account_file(creds_file, scopes=scopes)
    client = gspread.authorize(creds)

    spreadsheet = client.open_by_key(sheet_id)
    sheet = spreadsheet.worksheet('Products')

    # 清空旧数据（保留表头）
    last_row = sheet.row_count
    if last_row > 1:
        sheet.batch_clear([f"A2:I{last_row}"])

    # 写入新数据
    if rows:
        sheet.update(f"A2:I{1 + len(rows)}", rows)

    print(f"\nGoogle Sheet 已更新！共写入 {len(rows)} 条商品")


def main():
    parser = argparse.ArgumentParser(description='tinanz.com → nzbaobao.com 同步工具')
    parser.add_argument('--category', type=str, default='1026', help='tinanz.com 分类ID (默认: 1026 成都现货)')
    parser.add_argument('--output', type=str, choices=['csv', 'sheet'], default='csv', help='输出方式')
    parser.add_argument('--sheet-id', type=str, help='Google Sheet ID (output=sheet 时必填)')
    parser.add_argument('--creds', type=str, default='service_account.json', help='Google Service Account 凭证路径')
    parser.add_argument('--start-id', type=int, default=9, help='起始商品ID (默认9，避免覆盖内置1-8)')
    args = parser.parse_args()

    print(f"=== 开始抓取分类 {args.category} ===")
    products = fetch_products(args.category)

    if not products:
        print("未抓取到任何商品，请检查分类ID是否正确")
        return

    print(f"\n=== 转换格式 (起始ID: {args.start_id}) ===")
    rows = convert_to_sheet_format(products, args.start_id)

    nz_count = sum(1 for r in rows if r[5] == '新西兰直邮')
    au_count = sum(1 for r in rows if r[5] == '澳洲直邮')
    print(f"转换完成: 新西兰直邮={nz_count}, 澳洲直邮={au_count}, 总计={len(rows)}")

    if args.output == 'csv':
        filename = f"tinanz_{args.category}_products.csv"
        export_csv(rows, filename)
        print("\n导入方法:")
        print("1. 打开 Google Sheet → Products 表")
        print("2. 选中第2行起的数据并删除")
        print(f"3. 文件 → 导入 → 上传 → 选择 {filename}")
        print("4. 导入位置: 替换当前表 (从A1开始) 或 替换现有数据")
    else:
        if not args.sheet_id:
            print("错误: --sheet-id 必填")
            return
        update_google_sheet(rows, args.sheet_id, args.creds)


if __name__ == '__main__':
    main()
