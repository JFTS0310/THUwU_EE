import json
import requests
from bs4 import BeautifulSoup
import time
import os

def parse_course_page(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    
    basic_info = {}
    info_cols = soup.find_all('div', class_='column one-third')
    for col in info_cols:
        if '基本資料' in col.get_text():
            p_tag = col.find('p')
            if p_tag:
                lines = p_tag.get_text(separator='\n').split('\n')
                for line in lines:
                    line = line.strip()
                    if '修課班級：' in line:
                        basic_info['className'] = line.split('：')[1].strip()
                    if '修課年級：' in line:
                        basic_info['gradeLevel'] = line.split('：')[1].strip()

    grading_data = []
    table = soup.find('table', class_='aqua_table')
    if table:
        rows = table.find('tbody').find_all('tr')
        for row in rows[1:]:
            cols = row.find_all('td')
            if len(cols) >= 2:
                item = cols[0].get_text(strip=True)
                score = cols[1].get_text(strip=True)
                if item and score:
                    grading_data.append(f"{item}: {score}%")
    
    return {
        'className': basic_info.get('className', ''),
        'gradeLevel': basic_info.get('gradeLevel', ''),
        'grading': '\n'.join(grading_data)
    }

def main():
    json_path = '1142-data.json'
    if not os.path.exists(json_path):
        print(f"Error: {json_path} not found.")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        course_data = json.load(f)

    output_data = {}
    total = len(course_data)
    count = 0

    print(f"Start crawling {total} courses...")

    for course_id in course_data:
        count += 1
        url = f"https://course.thu.edu.tw/view/114/2/{course_id}"
        
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                extracted = parse_course_page(response.text)
                output_data[course_id] = extracted
                print(f"[{count}/{total}] {course_id} - Success")
            else:
                print(f"[{count}/{total}] {course_id} - HTTP {response.status_code}")
        except Exception as e:
            print(f"[{count}/{total}] {course_id} - Error: {e}")
        
        if count % 100 == 0:
            with open('course-extras.json', 'w', encoding='utf-8') as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)

    with open('course-extras.json', 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print("Done! Saved to course-extras.json")

if __name__ == "__main__":
    main()