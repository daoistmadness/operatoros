import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { backupApiPath, createBackup, getBackupScheduler, listBackupHistory, getBackupStatus, listBackups, restoreBackup, updateBackupScheduler } from "./backups";

vi.mock("../lib/api/client",()=>({apiRequest:vi.fn()}));
describe("backup API",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("uses the canonical status endpoint",async()=>{vi.mocked(apiRequest).mockResolvedValueOnce({data:{},status:200,headers:{}});await getBackupStatus();expect(apiRequest).toHaveBeenCalledWith({path:"/api/admin/backups/status"});});
  it("uses the canonical list endpoint",async()=>{vi.mocked(apiRequest).mockResolvedValueOnce({data:[],status:200,headers:{}});await listBackups();expect(apiRequest).toHaveBeenCalledWith({path:"/api/admin/backups"});});
  it("creates through the canonical endpoint",async()=>{vi.mocked(apiRequest).mockResolvedValueOnce({data:{},status:200,headers:{}});await createBackup();expect(apiRequest).toHaveBeenCalledWith({path:"/api/admin/backups",method:"POST"});});
  it("restores with exact confirmation",async()=>{vi.mocked(apiRequest).mockResolvedValueOnce({data:{success:true},status:200,headers:{}});await restoreBackup("backup_2026-07-13T00-00-00Z.sqlite3","backup_2026-07-13T00-00-00Z.sqlite3");expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({path:"/api/admin/backups/backup_2026-07-13T00-00-00Z.sqlite3/restore",method:"POST",body:{confirmation:"backup_2026-07-13T00-00-00Z.sqlite3"}}));});
  it("loads scheduler settings and history",async()=>{vi.mocked(apiRequest).mockResolvedValue({data:[],status:200,headers:{}});await getBackupScheduler();await listBackupHistory();expect(apiRequest).toHaveBeenNthCalledWith(1,{path:"/api/admin/backups/scheduler"});expect(apiRequest).toHaveBeenNthCalledWith(2,{path:"/api/admin/backups/history"});});
  it("updates scheduler settings",async()=>{const body={enabled:true,schedule_type:"interval" as const,interval_minutes:60,hour_utc:1,minute_utc:0,weekday_utc:0,keep_daily:7,keep_weekly:4,keep_monthly:12};vi.mocked(apiRequest).mockResolvedValueOnce({data:{},status:200,headers:{}});await updateBackupScheduler(body);expect(apiRequest).toHaveBeenCalledWith({path:"/api/admin/backups/scheduler",method:"PUT",body});});
  it("never creates a double API prefix",()=>expect(backupApiPath("/status")).not.toContain("/api/api/"));
});
