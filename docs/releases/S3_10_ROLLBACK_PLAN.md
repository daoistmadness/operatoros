# S3.10 Rollback Plan

## OperatorOS v0.9.0

---

## Rollback Decision Matrix

| Situation | Action | Database Restore Needed? |
|---|---|---|
| Application code defect | Roll back application only | No |
| Migration error | Roll back application + verify schema | No (migrations are additive) |
| Data corruption | Restore from backup | Yes |
| Configuration error | Fix config, restart | No |
| Authentication failure | Verify AUTH_COOKIE_SECRET, restart | No |
| Performance degradation | Tune workers/resources | No |

---

## Pre-Rollback Verification

Before initiating any rollback, verify:

- [ ] Current release: v0.9.0 (tag: `26c0dc7`)
- [ ] Backup exists: `backups/operatoros_v0.9.0_production_20260716_135924.db`
- [ ] Backup integrity: PASS (SHA256 verified)
- [ ] Previous release artifact available (or git checkout)

---

## Rollback Procedure

### Phase 1: Stop New Deployment

```bash
# Stop the running backend service
kill $(lsof -t -i :8000)

# Verify the service has stopped
lsof -i :8000
# Expected: no output (port is free)

# Stop the frontend server if running
kill $(lsof -t -i :3000)
```

### Phase 2: Restore Previous Application Version

**Option A: Git checkout (if previous commit is known)**

```bash
# Checkout the previous release commit
git checkout <previous-release-tag>

# Rebuild and restart backend
cd backend
.venv/bin/uvicorn src.main:app --host 127.0.0.1 --port 8000 &

# Rebuild and serve frontend
cd frontend
npm run build
npx vite preview --host 127.0.0.1 --port 3000 &
```

**Option B: Docker Compose rollback**

```bash
# Stop current stack
docker-compose down

# Revert to previous image tag
# Edit docker-compose.yml or use specific image tags

# Restart
docker-compose up -d
```

### Phase 3: Database Rollback (Only If Necessary)

> **CRITICAL**: Database rollback is only required if a migration has caused data loss or corruption.
> For v0.9.0, all migrations are **additive** (CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX).
> Additive migrations do NOT require database rollback.

**If database rollback IS required:**

```bash
# 1. Verify the backup file
python3 -c "
import sqlite3
conn = sqlite3.connect('backups/operatoros_v0.9.0_production_20260716_135924.db')
c = conn.cursor()
print('Integrity:', c.execute('PRAGMA integrity_check').fetchone()[0])
print('FK violations:', len(c.execute('PRAGMA foreign_key_check').fetchall()))
conn.close()
"

# 2. Stop the backend
kill $(lsof -t -i :8000)

# 3. Replace the database with backup
cp backend/attendance.db backend/attendance.db.rollback-$(date +%Y%m%d_%H%M%S)
cp backups/operatoros_v0.9.0_production_20260716_135924.db backend/attendance.db

# 4. Verify restored database
python3 -c "
import sqlite3
conn = sqlite3.connect('backend/attendance.db')
c = conn.cursor()
print('Integrity:', c.execute('PRAGMA integrity_check').fetchone()[0])
for t in ['students', 'student_masters', 'student_device_identities', 'attendance', 'student_enrollments']:
    print(f'{t}:', c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
conn.close()
"

# 5. Restart the backend
```

### Phase 4: Verify Protected Counts

After rollback, verify:

```bash
python3 -c "
import sqlite3
conn = sqlite3.connect('backend/attendance.db')
c = conn.cursor()
checks = {
    'students': 117,
    'student_masters': 0,
    'student_device_identities': 0,
    'attendance': 3651,
    'student_enrollments': 0
}
all_ok = True
for t, expected in checks.items():
    actual = c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
    ok = actual == expected
    print(f'{\"✓\" if ok else \"✗\"} {t}: {actual} (expected {expected})')
    if not ok: all_ok = False
print()
print('Rollback data verification:', 'PASS' if all_ok else 'FAIL')
conn.close()
"
```

### Phase 5: Re-run Smoke Tests

1. Verify health endpoint: `curl http://127.0.0.1:8000/health`
2. Verify login page loads: Open `http://localhost:3000`
3. Test authentication: Log in with admin credentials
4. Verify navigation works across all pages
5. Verify protected endpoints return 401 without session

---

## Service State After Rollback

After rollback, the system should be restored to:

| Component | State |
|---|---|
| Backend API | Running on port 8000 |
| Frontend | Serving on port 3000 |
| Database | Pre-migration state (with backup preserved) |
| Users | As configured in restored database |
| Sessions | All invalidated (users must re-login) |

---

## Monitoring During Rollback

During the rollback window, monitor:

- [ ] Backend health check returns 200
- [ ] No 5xx errors in API responses
- [ ] Database integrity check passes
- [ ] Authentication succeeds with existing credentials
- [ ] Backup file integrity remains intact

---

## Rollback Test Scenarios

### Scenario 1: Application Code Only (Most Likely)

```
Trigger: Backend crashes on startup after deployment
Action: git checkout previous tag → rebuild frontend → restart services
Database: NOT modified
Expected time: 5-10 minutes
```

### Scenario 2: Migration Issue

```
Trigger: Schema migration fails or creates unexpected state
Action: All migrations are additive → no rollback needed for schema
         If data issue found: restore database from pre-migration backup
Expected time: 10-15 minutes
```

### Scenario 3: Configuration Error

```
Trigger: AUTH_COOKIE_SECRET mismatch or CORS configuration error
Action: Fix configuration in .env → restart services
Database: NOT modified
Expected time: 2-5 minutes
```

### Scenario 4: Catastrophic Data Loss (Worst Case)

```
Trigger: Accidental data deletion or corruption
Action: Stop services → restore database from backup → restart services
         → verify all counts → re-run smoke tests
Expected time: 15-30 minutes
```

---

## Rollback Success Criteria

- [ ] Health endpoint returns 200
- [ ] Login works with existing credentials
- [ ] Protected data counts match expected values
- [ ] All navigation pages load without errors
- [ ] No unexpected console errors
- [ ] Database integrity check passes
- [ ] Foreign key check passes (zero violations)

---

## Post-Rollback Actions

1. Document root cause of rollback
2. Create or update test coverage for the failure scenario
3. If database was rolled back, ensure no data is lost between backup and rollback
4. Schedule re-deployment after issue is resolved
5. Update ERRORS.md with the failure pattern

---

## Contact

| Role | Contact |
|---|---|
| Release Engineer | Sisyphus |
| System Administrator | MikhailRyu |

---

## Document History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-07-16 | Sisyphus | Initial rollback plan for v0.9.0 |
