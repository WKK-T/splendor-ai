import os
import sys

if sys.platform == 'win32' or os.environ.get('SPLENDOR_PORTABLE_SEARCH') == '1':
    from .portable import Search, static_data_json
else:
    from .splendor_pv_noble_search import *
