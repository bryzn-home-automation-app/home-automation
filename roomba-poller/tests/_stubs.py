"""
Stand-ins for poller.py's third-party imports (aiohttp, psycopg, roombapy_prime), installed
only for a package that isn't there, so the tests run on a machine without the image's
requirements. Inside the poller image the real packages are used. Either way the tests
never reach the network, the database or the robot: they replace the functions that would.
"""
import dataclasses
import enum
import importlib
import sys
import types


def _module(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    parent, _, child = name.rpartition(".")
    if parent:
        setattr(sys.modules[parent], child, mod)
    return mod


def _missing(name):
    try:
        importlib.import_module(name)
        return False
    except ImportError:
        return True


def real_roombapy_prime():
    """Whether the real roombapy_prime is in use (the poller image), not the stand-ins below
    (a stand-in module has no file)."""
    return getattr(sys.modules.get("roombapy_prime"), "__file__", None) is not None


def _no_database(*_args, **_kwargs):
    raise RuntimeError("psycopg stub: the tests have no database")


class _DockState(enum.IntEnum):
    DOCK_READY = 301


class _Record:
    """Keeps its keyword arguments as attributes: enough to build a command."""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _MissionCommandType(enum.Enum):
    START = "start"


class _RegionType(enum.Enum):
    RID = "rid"


# roombapy_prime.models.livemap (0.8.3) as poller.py reads it: frozen dataclasses with the
# library's own fields, so a test builds a message the way the library does (keywords, no
# assigning afterwards) and the same test runs against the real classes in the poller image.
@dataclasses.dataclass(frozen=True)
class _PositionSample:
    point: tuple
    orientation: float
    operating_modes: int


@dataclasses.dataclass(frozen=True)
class _PositionUpdateMessage:
    sequence_number: int
    updates: list
    last_update_timestamp: object
    expires_at: object = None


@dataclasses.dataclass(frozen=True)
class _MapUpdateMessage:
    livemap_url: str
    livemap_url_raw: object = None
    timestamp: object = None


@dataclasses.dataclass(frozen=True)
class _ScheduleOptions:
    """roombapy_prime's ScheduleOptions as far as a schedule write uses it: every field the
    server sent goes back unchanged, `enabled` as set."""
    raw: dict
    enabled: object = None

    def to_json(self):
        body = dict(self.raw)
        if self.enabled is not None:
            body["enabled"] = self.enabled
        return body


@dataclasses.dataclass(frozen=True)
class _HouseholdSchedule:
    schedule_id: str
    options: _ScheduleOptions

    @classmethod
    def from_json(cls, data):
        options = data.get("options") or {}
        return cls(schedule_id=data.get("schedule_id") or options.get("schedule_id") or "",
                   options=_ScheduleOptions(raw=dict(options), enabled=options.get("enabled")))

    def to_json(self):
        return {"schedule_id": self.schedule_id, "options": self.options.to_json()}


def install():
    if _missing("aiohttp"):
        _module("aiohttp", ClientSession=object)
    if _missing("psycopg"):
        _module("psycopg", connect=_no_database,
                AsyncConnection=types.SimpleNamespace(connect=_no_database))
        _module("psycopg.conninfo",
                make_conninfo=lambda **kw: " ".join(f"{k}={v}" for k, v in kw.items()))
        _module("psycopg.types")
        _module("psycopg.types.json", Json=lambda value: value)
    if _missing("roombapy_prime"):
        _module("roombapy_prime")
        _module("roombapy_prime.auth", login=_no_database)
        _module("roombapy_prime.models")
        _module("roombapy_prime.models.livemap",
                MapUpdateMessage=_MapUpdateMessage,
                PositionUpdateMessage=_PositionUpdateMessage,
                PositionSample=_PositionSample)
        _module("roombapy_prime.models.map_bundle", parse_map_bundle=lambda raw: {})
        _module("roombapy_prime.models.robot_info", DockState=_DockState)
        _module("roombapy_prime.models.mission_control",
                CommandParams=type("CommandParams", (_Record,), {}),
                MissionCommandType=_MissionCommandType,
                Region=type("Region", (_Record,), {}),
                RegionType=_RegionType,
                RoutineCommand=type("RoutineCommand", (_Record,), {}))
        _module("roombapy_prime.models.schedules_dnd", HouseholdSchedule=_HouseholdSchedule)
        _module("roombapy_prime.prime_factory", PrimeFactory=type("PrimeFactory", (), {}))
        _module("roombapy_prime.vendor_errors", vendor_error=lambda code: None)
