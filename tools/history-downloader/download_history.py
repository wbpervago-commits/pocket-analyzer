import json
import logging
import sys
import time
from getpass import getpass
from pathlib import Path

from pocketoptionapi import PocketOption

SYMBOL = "EURUSD_otc"
PERIOD = 60
OUTPUT = Path(__file__).with_name("EURUSD_otc_M1_history.json")


def main():
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
    print("Pocket Analyzer — отдельная загрузка истории Pocket Option")
    print("Режим: только чтение котировок. Сделки не открываются.")
    print()
    ssid = getpass("Вставьте полный кадр авторизации 42[\"auth\",...] и нажмите Enter: ").strip()
    if not ssid.startswith('42["auth"'):
        print("Ошибка: строка должна начинаться с 42[\"auth\".")
        input("Нажмите Enter для выхода...")
        return 2

    api = None
    try:
        api = PocketOption(ssid)
        print("Подключаемся к Pocket Option...")
        ok, error = api.connect()
        if not ok:
            print("Не удалось подключиться:", error or "нет ответа")
            input("Нажмите Enter для выхода...")
            return 1

        print("Соединение установлено. Синхронизируем время...")
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and not api.is_time_synced():
            time.sleep(0.2)
        if not api.is_time_synced():
            print("Не удалось синхронизировать время сервера.")
            input("Нажмите Enter для выхода...")
            return 1

        if not api.subscribe(SYMBOL, period=PERIOD):
            print("Сервер не принял подписку на", SYMBOL)
            input("Нажмите Enter для выхода...")
            return 1
        time.sleep(1)

        print("Запрашиваем минутные свечи за последние 24 часа...")
        candles = api.get_historical_candles(
            SYMBOL,
            period=PERIOD,
            offset=1440,
            count_request=1,
        )
        if not candles:
            print("Сервер не вернул исторические свечи.")
            print("Это отдельный результат проверки, не ошибка рабочего расширения.")
            input("Нажмите Enter для выхода...")
            return 1

        normalized = []
        for candle in candles:
            try:
                stamp = int(float(candle.get("time", candle.get("timestamp"))))
                if stamp > 10**12:
                    stamp //= 1000
                row = {
                    "time": stamp,
                    "open": float(candle["open"]),
                    "high": float(candle["high"]),
                    "low": float(candle["low"]),
                    "close": float(candle["close"]),
                }
                normalized.append(row)
            except (TypeError, ValueError, KeyError):
                continue

        normalized.sort(key=lambda item: item["time"])
        deduped = {item["time"]: item for item in normalized}
        normalized = list(deduped.values())[-1440:]

        if not normalized:
            print("Ответ получен, но в нём нет корректных минутных свечей.")
            input("Нажмите Enter для выхода...")
            return 1

        payload = {
            "symbol": SYMBOL,
            "period": PERIOD,
            "requested_hours": 24,
            "received": len(normalized),
            "candles": normalized,
        }
        OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        first = time.strftime("%d.%m.%Y %H:%M:%S", time.localtime(normalized[0]["time"]))
        last = time.strftime("%d.%m.%Y %H:%M:%S", time.localtime(normalized[-1]["time"]))
        print()
        print("ГОТОВО")
        print("Получено свечей:", len(normalized))
        print("Первая свеча:", first)
        print("Последняя свеча:", last)
        print("Файл сохранён:", OUTPUT.name)
        print("Это тест истории. Рабочее расширение и Pocket Analyzer не изменялись.")
        input("Нажмите Enter для выхода...")
        return 0
    except Exception as exc:
        print("Ошибка загрузчика:", str(exc))
        input("Нажмите Enter для выхода...")
        return 1
    finally:
        if api is not None:
            try:
                api.disconnect_websocket()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
