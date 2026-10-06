"""The scanner's own code against stand-in pages and a stand-in clock.

Loads scripts/scrape.py without its command line or the imports that need
packages (requests, image_store), as tests/profile-views.test.mjs does, then
runs the case given as the second argument with these in scope:

  ns          the scanner's namespace
  clock       time.time / time.sleep for the scanner: a sleep moves the clock
              at once and is written down (clock.sleeps)
  ResultsPage a results page of invented people, a page at a time, with
              Next, optional lazy loading (people that appear only once the
              page is scrolled), and switches that break the new layers
  out         a dict the case fills in; printed as JSON on the last line

Nothing here opens a browser or reaches LinkedIn or the app. Invented people only.
"""
import ast
import json
import random
import sys
import types
from pathlib import Path

tree = ast.parse(open(sys.argv[1]).read())
skip = lambda n: (isinstance(n, ast.If)
                  or (isinstance(n, ast.Import) and any(a.name == 'requests' for a in n.names))
                  or (isinstance(n, ast.ImportFrom) and n.module == 'image_store'))
ns = {'__name__': 'scrape', '__file__': sys.argv[1]}
exec(compile(ast.Module(body=[n for n in tree.body if not skip(n)], type_ignores=[]), 'scrape.py', 'exec'), ns)


class TryLater(Exception):
    pass


ns['TryLater'] = TryLater
posted = []


def refuse(*a, **k):
    raise AssertionError('nothing here may reach the network')


def post(url, headers=None, json=None, **_):
    posted.append({'url': url, 'json': json})
    return types.SimpleNamespace(status_code=200, json=lambda: {'ok': True, 'saved': 1}, text='')


ns['requests'] = types.SimpleNamespace(get=refuse, post=post)
ns['localize_images'] = refuse


class Clock:
    def __init__(self, t):
        self.t = t
        self.sleeps = []

    def time(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(round(float(s), 6))
        self.t += s


NOW = 1790000000.0
clock = Clock(NOW)
ns['time'] = clock


def person(i):
    return {'name': f'Invented Person {i}', 'headline': f'Analyst at Example Co {i}',
            'profileUrl': f'https://www.linkedin.com/in/invented-{i:04d}/', 'imageUrl': ''}


class Button:
    def __init__(self, page):
        self.page = page

    @property
    def first(self):
        return self

    def is_visible(self):
        return self.page.pg < self.page.pages

    def is_enabled(self):
        return True

    def click(self, timeout=None):
        self.page.pg += 1
        self.page.scrolled = 0
        self.page.clicks += 1


class Locator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    @property
    def first(self):
        return self

    def wait_for(self, state=None, timeout=None):
        if self.page.break_layers:
            raise RuntimeError('a broken layer')
        if not self.page.people():
            raise TimeoutError('nothing visible')


class Mouse:
    def __init__(self, page):
        self.page = page

    def move(self, x, y):
        pass

    def wheel(self, dx, dy):
        if self.page.break_layers:
            raise RuntimeError('a broken layer')
        self.page.wheels.append(dy)
        self.page.scrolled += 1


class ResultsPage:
    """`pages` pages of `per_page` people. `lazy` more on each page appear only
    after `lazy_after` wheel turns. `no_list` makes the new list check find no
    list (LIST_STATE_JS answers {}), while the old reader still reads the page.
    `break_layers` makes every new layer fail (wheel, locator, LIST_STATE_JS)."""

    def __init__(self, pages=3, per_page=10, lazy=0, lazy_after=2, no_list=False, break_layers=False,
                 blank_until=None):
        self.pages, self.per_page, self.lazy, self.lazy_after = pages, per_page, lazy, lazy_after
        self.no_list, self.break_layers = no_list, break_layers
        self.pg, self.scrolled, self.clicks, self.wheels, self.reloads = 1, 0, 0, [], 0
        self.blank_until = blank_until   # (page, clock time): the page shows nobody until then
        self.viewport_size = {'width': 1300, 'height': 860}
        self.mouse = Mouse(self)
        self.context = None

    @property
    def url(self):
        return 'https://www.linkedin.com/search/results/people/?connectionOf=x&page=%d' % self.pg

    def people(self):
        if self.blank_until and self.pg == self.blank_until[0] and clock.t < self.blank_until[1]:
            return []
        base = (self.pg - 1) * (self.per_page + self.lazy)
        shown = self.per_page + (self.lazy if self.scrolled >= self.lazy_after else 0)
        return [person(base + i) for i in range(shown)]

    def goto(self, url, **_):
        return types.SimpleNamespace(status=200)

    def reload(self, **_):
        self.reloads += 1
        return types.SimpleNamespace(status=200)

    def is_closed(self):
        return False

    def wait_for_selector(self, selector, timeout=None):
        if not self.people():
            raise TimeoutError('no results')

    def locator(self, selector):
        if 'Next' in selector:
            return Button(self)
        return Locator(self, selector)

    def evaluate(self, js, *args):
        if js == ns['BRIDGE_RESULTS_JS']:
            return self.people()
        if js == ns['RESULT_LINKS_JS']:
            return sorted(p['profileUrl'] for p in self.people())
        if js == ns['LIST_STATE_JS']:
            if self.break_layers:
                raise RuntimeError('a broken layer')
            if self.no_list:
                return {}
            return {'count': len(self.people()), 'height': 120 * len(self.people())}
        if js in (ns['SEARCH_LIMIT_JS'], ns['NO_RESULTS_JS'], ns['TOO_MANY_JS']):
            return False
        if js in (ns['PUSHBACK_JS'],):
            return None
        if js == ns['RESULT_COUNT_JS']:
            return self.pages * self.per_page
        if js == ns['CURRENT_PAGE_JS']:
            return self.pg
        return None


class Response:
    def __init__(self, url, data):
        self.url, self._data = url, data

    def json(self):
        return self._data


class ProfilePage:
    """Profiles by URL: {url: {"name", "data": [api json], "embedded": [json text], "dom": EXPERIENCE_JS's
    answer, "shown": bool, "unavailable": bool, "pushback": str|None}}. Opening one replays its API
    responses to whatever listens, as the browser would."""

    def __init__(self, profiles):
        self.profiles, self.at, self.opened, self.listeners = profiles, None, [], []
        self.viewport_size = {'width': 1300, 'height': 860}
        self.mouse = types.SimpleNamespace(move=lambda *a: None, wheel=lambda *a: None)
        self.context = None

    @property
    def url(self):
        return self.at or 'https://www.linkedin.com/feed/'

    def on(self, event, fn):
        self.listeners.append(fn)

    def goto(self, url, **_):
        self.at = url
        self.opened.append([url, clock.t])
        for data in self.profiles.get(url, {}).get('data', []):
            for fn in self.listeners:
                fn(Response('https://www.linkedin.com/voyager/api/graphql?queryId=invented', data))
        return types.SimpleNamespace(status=self.profiles.get(url, {}).get('status', 200))

    def reload(self, **_):
        return self.goto(self.at)

    def is_closed(self):
        return False

    def set_default_timeout(self, _):
        pass

    def set_default_navigation_timeout(self, _):
        pass

    def evaluate(self, js, *args):
        p = self.profiles.get(self.at, {})
        if js == ns['PROFILE_SHOWN_JS']:
            return p.get('shown', True)
        if js == ns['EXPERIENCE_JS']:
            return p.get('dom', {'found': False, 'how': None, 'items': [], 'showAll': None})
        if js == ns['EMBEDDED_DATA_JS']:
            return p.get('embedded', [])
        if js == ns['PUSHBACK_JS']:
            return p.get('pushback')
        if 'this profile is not available' in js:
            return p.get('unavailable', False)
        if 'scrollHeight' in js and 'scrollTo' not in js:
            return 3000
        return None


def install_browser(page):
    """sync_playwright, for the scanner, handing out `page` in a browser that does nothing else."""
    class Browser:
        pages = [page]

        def new_page(self):
            return page

        def close(self):
            pass

    class Playwright:
        def __enter__(self):
            return types.SimpleNamespace(chromium=types.SimpleNamespace(
                launch_persistent_context=lambda **_: Browser()))

        def __exit__(self, *a):
            return False

    api = types.ModuleType('playwright.sync_api')
    api.sync_playwright = Playwright
    sys.modules['playwright'] = types.ModuleType('playwright')
    sys.modules['playwright.sync_api'] = api
    ns['launch_chrome'] = lambda p, **_: p.chromium.launch_persistent_context()
    ns['ensure_logged_in'] = lambda page, **_: True


def read(page, **kw):
    """Read a list with the scanner's own loop: (urls read, status, reach)."""
    people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Bridge', 'b1',
                                                     'https://www.linkedin.com/in/invented-bridge/',
                                                     urn='urn:li:fsd_profile:INVENTED', **kw)
    return [p['profileUrl'] for p in people], status, reach


ns['searches_left'] = lambda now=None: (999, 'daily')
ns['charge_linkedin'] = lambda kind='searches', n=1: charged.append(kind)
charged = []
ns['PACE_RNG'].seed(7)
home = Path(ns['_home']())
out = {}
exec(sys.argv[2])
print('RESULT ' + json.dumps(out))
