import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import BackupManagement,{BackupHistoryPanel,BackupList,BackupStatusPanel,canRestore,formatBytes,handleRestoreReauthentication,RESTORE_WARNING,RestoreDialogBody,SchedulerPanel} from "./BackupManagement";
import type {BackupEntry,BackupStatus} from "../api/backups";
import {QueryClientProvider} from "@tanstack/react-query";
import {createTestQueryClient} from "../lib/query/queryClient";

vi.mock("../api/backups",()=>({createBackup:vi.fn(),getBackupStatus:vi.fn(()=>new Promise(()=>{})),listBackups:vi.fn(()=>new Promise(()=>{})),getBackupScheduler:vi.fn(()=>new Promise(()=>{})),listBackupHistory:vi.fn(()=>new Promise(()=>{})),updateBackupScheduler:vi.fn(),restoreBackup:vi.fn(),deleteBackup:vi.fn(),downloadBackupUrl:vi.fn((f)=>`/api/admin/backups/${f}/download`)}));
vi.mock("lucide-react",()=>{
  const Icon=(props:Record<string,unknown>)=><span {...props}/>;
  return {AlertCircle:Icon,AlertTriangle:Icon,ArrowLeft:Icon,CheckCircle2:Icon,DatabaseBackup:Icon,HardDrive:Icon,Inbox:Icon,Loader2:Icon,RefreshCw:Icon,RotateCcw:Icon,ShieldAlert:Icon,X:Icon,Download:Icon,Trash2:Icon};
});
const status:BackupStatus={latest_backup_timestamp:"2026-07-13T00:00:00Z",latest_backup_outcome:"success",backup_count:1,retention_limit:10,free_disk_space_bytes:1048576,database_basename:"attendance.db",sqlite_journal_mode:"wal",destructive_operations_enabled:false,authentication_available:true,restore_support_mode:"single_process_only",restore_requires_admin:true,restore_requires_reauthentication:true,restore_multi_worker_safe:false};
const item:BackupEntry={filename:"backup_2026-07-13T00-00-00Z.sqlite3",created_at:"2026-07-13T00:00:00Z",trigger:"manual",size:2048,checksum:"abcdef1234567890",schema_version:"unknown"};
const html=(node:React.ReactNode)=>renderToStaticMarkup(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
describe("Backup Management",()=>{
  it("renders its loading state",()=>expect(html(<BackupManagement/>)).toContain("Loading backup management"));
  it("renders safe status values",()=>{const out=html(<BackupStatusPanel status={status}/>);expect(out).toContain("attendance.db");expect(out).toContain("WAL");expect(out).toContain("1 of 10");});
  it("renders the administrator restriction in the page shell",()=>expect(html(<BackupManagement/>)).toContain("restricted to authenticated administrators"));
  it("renders a backup row",()=>{const out=html(<BackupList backups={[item]} onRestore={vi.fn()} onDelete={vi.fn()}/>);expect(out).toContain(item.filename);expect(out).toContain("abcdef123456");});
  it("renders an empty list state",()=>expect(html(<BackupList backups={[]} onRestore={vi.fn()} onDelete={vi.fn()}/>)).toContain("No backups have been created yet"));
  it("formats byte sizes",()=>{expect(formatBytes(2048)).toBe("2.0 KB");expect(formatBytes(1048576)).toBe("1.0 MB");});
  it("blocks restore while destructive mode is disabled",()=>expect(canRestore(item.filename,item.filename,false,false)).toBe(false));
  it("blocks restore before exact match",()=>expect(canRestore(item.filename,"wrong",true,false)).toBe(false));
  it("enables restore for exact match",()=>expect(canRestore(item.filename,item.filename,true,false)).toBe(true));
  it("blocks duplicate restore while busy",()=>expect(canRestore(item.filename,item.filename,true,true)).toBe(false));
  it("shows the destructive restore warning",()=>expect(RESTORE_WARNING).toContain("pre-restore safety snapshot"));
  it("renders a disabled restore button before matching",()=>expect(html(<RestoreDialogBody backup={item} confirmation="wrong" setConfirmation={vi.fn()} destructiveEnabled busy={false} onCancel={vi.fn()} onRestore={vi.fn()}/>)).toContain("disabled"));
  it("discloses disabled local settings",()=>expect(html(<RestoreDialogBody backup={item} confirmation={item.filename} setConfirmation={vi.fn()} destructiveEnabled={false} busy={false} onCancel={vi.fn()} onRestore={vi.fn()}/>)).toContain("disabled by local system settings"));
  it("clears auth and redirects after a successful restore",()=>{const navigate=vi.fn();const unauthorized=vi.fn();window.addEventListener("astryx:auth-unauthorized",unauthorized);const handled=handleRestoreReauthentication({success:true,status:"restored",reauthentication_required:true,message:"Restore completed successfully. Please sign in again.",restored_filename:item.filename,pre_restore_snapshot_filename:"safety.sqlite3",checksum_verified:true,schema_verified:true,integrity_verified:true,required_tables_verified:true,completed_at:"2026-07-14T00:00:00Z"},navigate);expect(handled).toBe(true);expect(unauthorized).toHaveBeenCalledOnce();expect(navigate).toHaveBeenCalledWith("/login",expect.objectContaining({replace:true}));window.removeEventListener("astryx:auth-unauthorized",unauthorized);});
  it("renders scheduler settings",()=>{const config={enabled:true,schedule_type:"daily" as const,interval_minutes:1440,hour_utc:1,minute_utc:0,weekday_utc:0,keep_daily:7,keep_weekly:4,keep_monthly:12,next_run_at:"2026-07-15T01:00:00Z",updated_at:"2026-07-14T00:00:00Z"};const out=html(<SchedulerPanel config={config} saving={false} onSave={vi.fn()}/>);expect(out).toContain("Scheduled Backups");expect(out).toContain("2026-07-15T01:00:00Z");});
  it("renders failed execution details",()=>{const out=html(<BackupHistoryPanel rows={[{id:1,backup_filename:null,started_at:"2026-07-14T00:00:00Z",completed_at:"2026-07-14T00:00:01Z",duration_seconds:1,status:"FAILED",error_message:"disk full",trigger_type:"SCHEDULED",size_bytes:null,checksum:null,integrity_verified:false,removed_backups:[]}]}/>);expect(out).toContain("FAILED");expect(out).toContain("disk full");});
});
