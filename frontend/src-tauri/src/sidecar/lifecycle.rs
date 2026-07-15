use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleState {
    Stopped,
    Starting,
    Ready,
    Failed,
    Stopping,
    Crashed,
}

impl LifecycleState {
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Stopped, Self::Starting)
                | (Self::Starting, Self::Ready | Self::Failed | Self::Stopping)
                | (Self::Ready, Self::Stopping | Self::Crashed)
                | (
                    Self::Failed,
                    Self::Starting | Self::Stopping | Self::Stopped
                )
                | (Self::Stopping, Self::Stopped)
                | (
                    Self::Crashed,
                    Self::Starting | Self::Stopping | Self::Stopped
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
        assert!(Starting.can_transition_to(Ready));
        assert!(Starting.can_transition_to(Failed));
        assert!(Ready.can_transition_to(Crashed));
        assert!(Ready.can_transition_to(Stopping));
        assert!(Stopping.can_transition_to(Stopped));
        assert!(!Stopped.can_transition_to(Ready));
        assert!(!Crashed.can_transition_to(Ready));
    }
}
