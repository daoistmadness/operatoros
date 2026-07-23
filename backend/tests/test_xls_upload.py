import importlib
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException

MODULE_PREFIXES = ("src", "api", "core", "models", "services")
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"

def unload_app_modules() -> None:
    for name in list(sys.modules):
        if name == "src" or name.startswith(MODULE_PREFIXES):
            sys.modules.pop(name, None)

def prepare_source_imports(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(SOURCE_ROOT))

@pytest.fixture
def app_context(monkeypatch, tmp_path):
    db_path = tmp_path / "attendance-test.db"
    prepare_source_imports(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    unload_app_modules()

    main_module = importlib.import_module("src.main")
    db_module = importlib.import_module("core.database")
    uploads_router = importlib.import_module("api.uploads")
    excel_parser = importlib.import_module("services.excel_parser")

    return {
        "app": main_module.app,
        "db_module": db_module,
        "uploads": uploads_router,
        "excel_parser": excel_parser,
        "User": importlib.import_module("models.user").User,
    }

def test_xls_extension_validation_success(app_context):
    """Verify that file extension validation accepts .xls files."""
    uploads = app_context["uploads"]
    
    # Mock FastAPI UploadFile
    mock_file = MagicMock()
    mock_file.filename = "attendance_export.xls"
    mock_file.content_type = "application/vnd.ms-excel"
    
    uploads._validate_excel_upload(mock_file)

def test_invalid_extension_rejected(app_context):
    """Verify that unsupported extensions are rejected."""
    uploads = app_context["uploads"]
    
    mock_file = MagicMock()
    mock_file.filename = "attendance_export.csv"
    mock_file.content_type = "text/csv"
    
    with pytest.raises(HTTPException) as exc_info:
        uploads._validate_excel_upload(mock_file)
        
    assert exc_info.value.status_code == 400
    assert "Please upload a .xlsx or .xls file." in exc_info.value.detail

@patch("pandas.ExcelFile")
@patch("pandas.read_excel")
def test_excel_parser_selects_xlrd_engine(mock_read_excel, mock_excel_file, app_context):
    """Verify that parse_excel chooses the 'xlrd' engine for .xls files."""
    excel_parser = app_context["excel_parser"]
    
    mock_file = MagicMock()
    mock_file.filename = "logs.xls"
    mock_file.file = MagicMock()
    
    # Mocking Excel File reading to not throw errors on missing columns
    mock_df = MagicMock()
    mock_df.columns = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"]
    mock_read_excel.return_value = mock_df
    
    db_session = MagicMock()
    
    with patch("services.excel_parser._load_cutoff_map") as mock_cutoff:
        mock_cutoff.return_value = {}
        
        # Execute parse_excel and catch any internal validation
        import asyncio
        try:
            asyncio.run(
                excel_parser.parse_excel(mock_file, db_session)
            )
        except Exception:
            # We only care that ExcelFile was initialized with engine="xlrd"
            pass
            
        mock_excel_file.assert_called_with(mock_file.file, engine="xlrd")
