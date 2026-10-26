"""Independent opponent and teaching-hint selectors for future clients."""
import threading

from .inference import Runtime

OPTIONS = {
    'easy': 'Transformer seed422 100M · 合法首选',
    'medium': 'Transformer seed422 200M · 合法首选',
    'hard': 'PV422 · MCTS128',
    'hell': 'PV422 · MCTS256（候选）',
}
_UNCHANGED = object()


class LocalSession:
    """Process-local selections, no writing to existing application settings."""
    def __init__(self, runtime=None, opponent_profile='medium', hint_profile='medium'):
        self.runtime = runtime if runtime is not None else Runtime()
        self._lock = threading.RLock()
        self.configure(opponent_profile=opponent_profile, hint_profile=hint_profile)

    def configure(self, *, opponent_profile=_UNCHANGED, hint_profile=_UNCHANGED):
        with self._lock:
            if opponent_profile is not _UNCHANGED and opponent_profile not in OPTIONS:
                raise ValueError('opponent_profile must be easy, medium, hard, or hell')
            if hint_profile is not _UNCHANGED and hint_profile is not None and hint_profile not in OPTIONS:
                raise ValueError('hint_profile must be null (off), easy, medium, hard, or hell')
            # Validate both first, so a failed update leaves both unchanged.
            if opponent_profile is not _UNCHANGED:
                self._opponent_profile = opponent_profile
            if hint_profile is not _UNCHANGED:
                self._hint_profile = hint_profile
            return self.settings()

    def settings(self):
        with self._lock:
            return {'opponent_profile': self._opponent_profile, 'hint_profile': self._hint_profile,
                    'hint_enabled': self._hint_profile is not None, 'options': dict(OPTIONS)}

    def suggest(self, observation, *, purpose='opponent', **kwargs):
        with self._lock:
            if purpose not in ('opponent', 'hint'):
                raise ValueError('purpose must be opponent or hint')
            profile = self._hint_profile if purpose == 'hint' else self._opponent_profile
            if profile is None:
                return {'purpose': 'hint', 'enabled': False, 'action_index': None, 'action': None}
            return {'purpose': purpose, 'enabled': True, **self.runtime.infer(observation, profile, **kwargs)}
