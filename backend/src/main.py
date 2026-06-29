# main.py
# FastAPI application entry point.
# Tech Stack: FastAPI / Python 3.12

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.analytics import get_tardiness_summary_by_jenjang, router as analytics_router
from api.config import router as config_router
from api.grades import router as grades_router
from api.students import router as students_router
from api.uploads import router as uploads_router
from api.system import router as system_router
from api.review import router as review_router
from core.database import init_db

from core.config import settings

app = FastAPI(
    title="School Attendance Analytics",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — configured for React dev server and any WSL IP added to ALLOWED_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables on startup
init_db()

# Routers
app.include_router(analytics_router, prefix="/analytics", tags=["analytics"])
app.include_router(config_router, prefix="/config", tags=["config"])
app.include_router(students_router, prefix="/students", tags=["students"])
app.include_router(uploads_router, prefix="/uploads", tags=["uploads"])
app.include_router(system_router, prefix="/system", tags=["system"])
app.include_router(review_router, prefix="/review", tags=["review"])
app.include_router(grades_router, prefix="/api/grades", tags=["grades"])
app.add_api_route(
    "/api/tardiness/summary-by-jenjang",
    get_tardiness_summary_by_jenjang,
    methods=["GET"],
    tags=["analytics"],
)



@app.get("/", tags=["health"])
def read_root() -> dict:
    return {"status": "ok", "message": "School Attendance Analytics API"}
