import json
import os

SSQ_BUILTIN = [
    {"period": "25035", "redNumbers": [3, 4, 10, 16, 19, 23], "blueNumber": 14},
    {"period": "25034", "redNumbers": [5, 8, 15, 18, 27, 28], "blueNumber": 13},
    {"period": "25033", "redNumbers": [3, 8, 12, 19, 25, 32], "blueNumber": 14},
    {"period": "25032", "redNumbers": [5, 8, 13, 14, 19, 22], "blueNumber": 14},
    {"period": "25031", "redNumbers": [1, 5, 11, 15, 16, 26], "blueNumber": 3},
    {"period": "25030", "redNumbers": [4, 7, 10, 14, 22, 31], "blueNumber": 14},
    {"period": "25029", "redNumbers": [1, 6, 9, 15, 19, 22], "blueNumber": 10},
    {"period": "25028", "redNumbers": [3, 9, 18, 19, 26, 32], "blueNumber": 14},
    {"period": "25027", "redNumbers": [5, 8, 9, 15, 20, 31], "blueNumber": 11},
    {"period": "25026", "redNumbers": [7, 12, 20, 25, 31, 33], "blueNumber": 10},
    {"period": "25025", "redNumbers": [2, 8, 16, 21, 22, 30], "blueNumber": 14},
    {"period": "25024", "redNumbers": [3, 7, 11, 15, 19, 28], "blueNumber": 15},
    {"period": "25023", "redNumbers": [4, 6, 15, 17, 24, 30], "blueNumber": 8},
    {"period": "25022", "redNumbers": [9, 11, 14, 20, 27, 33], "blueNumber": 3},
    {"period": "25021", "redNumbers": [2, 6, 8, 16, 26, 28], "blueNumber": 11},
    {"period": "25020", "redNumbers": [3, 8, 12, 18, 20, 29], "blueNumber": 14},
    {"period": "25019", "redNumbers": [5, 8, 11, 18, 27, 30], "blueNumber": 9},
    {"period": "25018", "redNumbers": [3, 9, 14, 22, 25, 33], "blueNumber": 12},
    {"period": "25017", "redNumbers": [4, 8, 15, 22, 24, 32], "blueNumber": 10},
    {"period": "25016", "redNumbers": [2, 7, 10, 16, 21, 30], "blueNumber": 9},
]

DLT_BUILTIN = [
    {"period": "25035", "frontNumbers": [1, 8, 14, 20, 27], "backNumbers": [5, 11]},
    {"period": "25034", "frontNumbers": [3, 9, 12, 21, 29], "backNumbers": [4, 10]},
    {"period": "25033", "frontNumbers": [4, 8, 15, 22, 31], "backNumbers": [3, 9]},
    {"period": "25032", "frontNumbers": [2, 10, 18, 24, 33], "backNumbers": [1, 8]},
    {"period": "25031", "frontNumbers": [5, 11, 17, 23, 30], "backNumbers": [2, 7]},
    {"period": "25030", "frontNumbers": [1, 7, 14, 19, 28], "backNumbers": [5, 11]},
    {"period": "25029", "frontNumbers": [3, 9, 15, 20, 32], "backNumbers": [3, 10]},
    {"period": "25028", "frontNumbers": [6, 12, 18, 25, 34], "backNumbers": [1, 9]},
    {"period": "25027", "frontNumbers": [2, 8, 16, 21, 29], "backNumbers": [4, 11]},
    {"period": "25026", "frontNumbers": [4, 10, 17, 22, 30], "backNumbers": [2, 8]},
]


def convert_ssq(raw):
    return {
        "period": int(raw["period"]),
        "balls": sorted(raw["redNumbers"]),
        "blue": raw["blueNumber"],
    }


def convert_dlt(raw):
    return {
        "period": int(raw["period"]),
        "balls": sorted(raw["frontNumbers"]),
        "back": sorted(raw["backNumbers"]),
    }


def ensure_data_files():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, "..", "data")
    os.makedirs(data_dir, exist_ok=True)
    ssq_path = os.path.join(data_dir, "ssq_history.json")
    dlt_path = os.path.join(data_dir, "dlt_history.json")

    if not os.path.exists(ssq_path) or os.path.getsize(ssq_path) <= 10:
        with open(ssq_path, "w", encoding="utf-8") as f:
            json.dump([convert_ssq(r) for r in SSQ_BUILTIN], f, ensure_ascii=False, indent=2)
        print("Write builtin SSQ data:", ssq_path)

    if not os.path.exists(dlt_path) or os.path.getsize(dlt_path) <= 10:
        with open(dlt_path, "w", encoding="utf-8") as f:
            json.dump([convert_dlt(r) for r in DLT_BUILTIN], f, ensure_ascii=False, indent=2)
        print("Write builtin DLT data:", dlt_path)


if __name__ == "__main__":
    ensure_data_files()
