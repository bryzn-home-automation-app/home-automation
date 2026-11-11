"""
Stand-ins for poller.py's third-party imports (aiohttp, psycopg, roombapy_prime), installed
only for a package that isn't there, so the tests run on a machine without the image's
requirements. Inside the poller image the real packages are used. Either way the tests
never reach the network, the database or the robot: they replace the functions that would.
"""
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


def _no_database(*_args, **_kwargs):
    raise RuntimeError("psycopg stub: the tests have no database")


class _DockState(enum.IntEnum):
    DOCK_READY = 301


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
                MapUpdateMessage=type("MapUpdateMessage", (), {}),
                PositionUpdateMessage=type("PositionUpdateMessage", (), {}))
        _module("roombapy_prime.models.map_bundle", parse_map_bundle=lambda raw: {})
        _module("roombapy_prime.models.robot_info", DockState=_DockState)
        _module("roombapy_prime.prime_factory", PrimeFactory=type("PrimeFactory", (), {}))
        _module("roombapy_prime.vendor_errors", vendor_error=lambda code: None)
