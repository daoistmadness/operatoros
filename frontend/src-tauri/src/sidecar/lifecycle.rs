use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleState {
    Stopped,
    Starting,
    LocatingBackend,
    SelectingPort,
    SpawningBackend,
    WaitingForReadiness,
    Ready,
    Failed,
    Stopping,
    Crashed,
    BackendFailed,
    ReadinessTimeout,
    PortConflict,
    Restarting,
    FatalConfigurationError,
}

impl LifecycleState {
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Stopped, Self::Starting)
                | (
                    Self::Starting,
                    Self::LocatingBackend | Self::Failed | Self::Stopping | Self::Restarting
                )
                | (
                    Self::LocatingBackend,
                    Self::SelectingPort
                        | Self::FatalConfigurationError
                        | Self::Stopping
                        | Self::Restarting
                )
                | (
                    Self::SelectingPort,
                    Self::SpawningBackend | Self::PortConflict | Self::Stopping | Self::Restarting
                )
                | (
                    Self::SpawningBackend,
                    Self::WaitingForReadiness
                        | Self::BackendFailed
                        | Self::Stopping
                        | Self::Restarting
                )
                | (
                    Self::WaitingForReadiness,
                    Self::Ready
                        | Self::ReadinessTimeout
                        | Self::BackendFailed
                        | Self::Stopping
                        | Self::Restarting
                )
                | (Self::Ready, Self::Stopping | Self::Crashed)
                | (
                    Self::Restarting,
                    Self::Starting | Self::Failed | Self::FatalConfigurationError | Self::Stopping
                )
                | (
                    Self::Failed
                        | Self::FatalConfigurationError
                        | Self::PortConflict
                        | Self::BackendFailed
                        | Self::ReadinessTimeout,
                    Self::Starting | Self::Stopping | Self::Stopped
                )
                | (Self::Stopping, Self::Stopped)
                | (
                    Self::Crashed,
                    Self::Starting | Self::Restarting | Self::Stopping | Self::Stopped
                )
        )
    }
}

#[cfg(test)]
mod tests {
    use super::LifecycleState::*;

    #[test]
    fn frozen_state_transitions_are_enforced() {
        assert!(Stopped.can_transition_to(Starting));
        assert!(Starting.can_transition_to(LocatingBackend));
        assert!(LocatingBackend.can_transition_to(SelectingPort));
        assert!(SelectingPort.can_transition_to(SpawningBackend));
        assert!(SpawningBackend.can_transition_to(WaitingForReadiness));
        assert!(WaitingForReadiness.can_transition_to(Ready));
        assert!(Ready.can_transition_to(Crashed));
        assert!(Ready.can_transition_to(Stopping));
        assert!(Stopping.can_transition_to(Stopped));
        assert!(!Stopped.can_transition_to(Ready));
        assert!(!Crashed.can_transition_to(Ready));
    }
}
