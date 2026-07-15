#[cfg(windows)]
mod platform {
    use std::iter;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    pub struct InstanceLock(HANDLE);

    unsafe impl Send for InstanceLock {}
    unsafe impl Sync for InstanceLock {}

    impl InstanceLock {
        pub fn acquire() -> Result<Self, String> {
            let name: Vec<u16> = "Local\\OperatorOSDesktopSingleInstance"
                .encode_utf16()
                .chain(iter::once(0))
                .collect();
            let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
            if handle.is_null() {
                return Err(format!(
                    "CreateMutexW failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
            if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
                unsafe { CloseHandle(handle) };
                return Err("another OperatorOS desktop instance is already running".into());
            }
            Ok(Self(handle))
        }
    }

    impl Drop for InstanceLock {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(windows)]
pub use platform::InstanceLock;

#[cfg(not(windows))]
pub struct InstanceLock;

#[cfg(not(windows))]
impl InstanceLock {
    pub fn acquire() -> Result<Self, String> {
        Ok(Self)
    }
}
