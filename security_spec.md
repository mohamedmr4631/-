# Security Specification — Smart Cloud Attendance System

## 1. Data Invariants
1. **Authentication & Verification**: Every read and write operation requires a signed-in Firebase user with `request.auth.token.email_verified == true`.
2. **Admin Isolation**: Only the bootstrapped admin (`mohamed.mr4631@gmail.com`) or UIDs present in `/admins/{uid}` may create/edit/delete employees, reset bound devices, modify branch IP lock settings, read `/settings/admin_secret`, or list all attendance logs across all sessions.
3. **No Raw PIN Exposure**: Employee PINs are stored exclusively as 64-character lowercase SHA-256 hex hashes (`pinHash`), never plaintext.
4. **Device Binding Integrity**: Once an employee document has a non-null `deviceId`, non-admin sessions cannot overwrite or clear `deviceId`; they may only preserve the existing `deviceId` or bind an unbound (`null`) device.
5. **State Machine Integrity**: Non-admin employee punch updates may only perform valid transitions (`out -> working`, `working -> break`, `break -> working`, `working|break -> out`) and may only mutate `status`, `deviceId`, `lastCheckIn`, `lastBreakStart`, `totalBreakMs`, and `updatedAt`.
6. **Immutable Audit Trail**: Documents in `/attendance_logs/{logId}` cannot be updated or deleted once created, must set `createdByUid == request.auth.uid`, must use `timestamp == request.time`, and must reference an existing `/employees/{employeeId}` via `existsAfter`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Anonymous client attempts to create an employee in `/employees/emp1`. -> Must return `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Signed-in user with `email: "mohamed.mr4631@gmail.com"` and `email_verified: false` attempts to update `/settings/branch`. -> Must return `PERMISSION_DENIED`.
3. **Privilege Escalation (Non-Admin Creates Employee)**: Verified non-admin user attempts to create `/employees/emp_rogue`. -> Must return `PERMISSION_DENIED`.
4. **Admin Secret Exfiltration**: Verified non-admin user attempts `get` on `/settings/admin_secret`. -> Must return `PERMISSION_DENIED`.
5. **Device Hijack**: Verified non-admin user attempts to update `/employees/emp1` changing `deviceId` from `"dev_abc12345"` to `"dev_attacker"`. -> Must return `PERMISSION_DENIED`.
6. **Device Unbind by Non-Admin**: Verified non-admin user attempts to reset `deviceId` to `null` on `/employees/emp1`. -> Must return `PERMISSION_DENIED`.
7. **Shadow / Ghost Field Injection**: Verified user updates `/employees/emp1` including an undeclared field `isAdmin: true` or `salary: 99999`. -> Must return `PERMISSION_DENIED`.
8. **Illegal State Shortcut**: Verified user attempts to transition `/employees/emp1` directly from `out` to `break`. -> Must return `PERMISSION_DENIED`.
9. **Identity Spoofing in Attendance Log**: Verified user creates `/attendance_logs/log1` with `createdByUid: "someone_else"`. -> Must return `PERMISSION_DENIED`.
10. **Client-Forged Timestamp**: Verified user creates `/attendance_logs/log1` with a backdated `timestamp` not equal to `request.time`. -> Must return `PERMISSION_DENIED`.
11. **Orphaned Log Entry**: Verified user creates `/attendance_logs/log_orphan` referencing non-existent `employeeId: "non_existent_emp"`. -> Must return `PERMISSION_DENIED`.
12. **Audit Log Tampering / Deletion**: Verified user or admin attempts to `update` or `delete` `/attendance_logs/log1`, or non-admin attempts blanket `list` on `/attendance_logs` without `where('createdByUid', '==', uid)`. -> Must return `PERMISSION_DENIED`.
