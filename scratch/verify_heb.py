import sys
import os

# Add src to path
sys.path.append(os.path.join(os.getcwd(), "backend", "src"))

from core.database import SessionLocal, init_db
from services.attendance_metrics import calculate_heb, calculate_auto_heb, get_heb_override

init_db()
db = SessionLocal()

months = [1, 2, 3]
year = 2026
jenjangs = ["Primary", "Secondary"]

print(f"{'Jenjang':<12} | {'Month':<5} | {'Auto':<5} | {'Override':<8} | {'Final':<5}")
print("-" * 50)

for jenjang in jenjangs:
    for month in months:
        auto = calculate_auto_heb(db, jenjang, month, year)
        override = get_heb_override(db, jenjang, month, year)
        final = calculate_heb(db, jenjang, month, year)
        
        auto_val = auto['heb']
        override_val = override.heb_value if override else "-"
        final_val = final['heb']
        
        print(f"{jenjang:<12} | {month:<5} | {auto_val:<5} | {override_val:<8} | {final_val:<5}")

db.close()
