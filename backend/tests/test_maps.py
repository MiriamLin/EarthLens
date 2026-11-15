import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
import xarray as xr

from app.maps import aggregate_grid, build_annual_map, grid_weights, load_annual_map


class GridTests(unittest.TestCase):
    def setUp(self):
        self.latitudes = np.arange(-85, 90, 10)
        self.longitudes = np.arange(-175, 180, 10)

    def test_one_value_per_ten_degree_cell_keeps_correct_order(self):
        values = np.arange(648, dtype=float).reshape(1, 18, 36)
        result = aggregate_grid(values, self.latitudes, self.longitudes)
        np.testing.assert_allclose(result, values)

    def test_area_weights_cover_poles_and_wrap_the_dateline(self):
        latitudes = np.linspace(-90, 90, 361)
        longitudes = np.arange(-180, 180, 0.625)
        lat_weights, lon_weights = grid_weights(latitudes, longitudes)
        self.assertAlmostEqual(lat_weights.sum(), 2)
        self.assertAlmostEqual(lon_weights.sum(), 2 * np.pi)
        self.assertGreater(lon_weights[0, 0], 0)
        self.assertGreater(lon_weights[-1, 0], 0)
        result = aggregate_grid(np.ones((1, 361, 576)) * 7, latitudes, longitudes)
        self.assertEqual(result.shape, (1, 18, 36))
        np.testing.assert_allclose(result, 7)

    def test_missing_values_are_not_averaged_as_zero(self):
        values = np.ones((1, 18, 36)) * 3
        values[0, 2, 5] = np.nan
        values[0, 3, 5] = -999
        result = aggregate_grid(values, self.latitudes, self.longitudes)
        self.assertTrue(np.isnan(result[0, 2, 5]))
        self.assertTrue(np.isnan(result[0, 3, 5]))
        self.assertEqual(result[0, 4, 5], 3)

    def test_averages_use_spherical_area_not_equal_latitude_weights(self):
        latitudes = np.arange(-87.5, 90, 5)
        values = np.zeros((1, 36, 36))
        values[:, 35, :] = 100
        result = aggregate_grid(values, latitudes, self.longitudes)
        expected = 100 * (1 - np.sin(np.deg2rad(85))) / (1 - np.sin(np.deg2rad(80)))
        self.assertAlmostEqual(result[0, 17, 0], expected)
        self.assertNotAlmostEqual(result[0, 17, 0], 50)

    def test_annual_frames_units_and_json_missing_values(self):
        values = np.ones((2, 18, 36)) * 100
        values[0, 0, 0] = np.nan
        dataset = xr.Dataset({
            'ALLSKY_SFC_SW_DWN': xr.DataArray(values, dims=['time', 'lat', 'lon'], attrs={'units': 'W m-2', 'long_name': 'Solar radiation'}),
        }, coords={'time': pd.to_datetime(['2020-12-31', '2021-12-31']), 'lat': self.latitudes, 'lon': self.longitudes})
        with patch('app.maps.fsspec.get_mapper'), patch('app.maps.xr.open_zarr', return_value=dataset):
            result = build_annual_map('ALLSKY_SFC_SW_DWN')
        self.assertEqual(result['units'], 'MJ/m^2/day')
        self.assertEqual([frame['year'] for frame in result['frames']], [2020, 2021])
        self.assertEqual(len(result['frames'][0]['values']), 648)
        self.assertIsNone(result['frames'][0]['values'][0])
        self.assertAlmostEqual(result['frames'][1]['values'][0], 8.64)
        json.dumps(result, allow_nan=False)

    def test_cached_grid_does_not_redownload_source(self):
        with TemporaryDirectory() as temporary, patch('app.maps.CACHE_DIR', Path(temporary)):
            with patch('app.maps.build_annual_map', return_value={'frames': []}) as build:
                self.assertEqual(load_annual_map('T2M'), {'frames': []})
                self.assertEqual(load_annual_map('T2M'), {'frames': []})
                build.assert_called_once_with('T2M')


if __name__ == '__main__':
    unittest.main()
