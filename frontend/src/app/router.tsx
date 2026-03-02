import { createBrowserRouter } from 'react-router-dom'
import { Layout } from './layout'
import { MediaLibrary } from '@/pages/MediaLibrary'
import { PersonHome } from '@/pages/PersonHome'
import { AlbumDetail } from '@/pages/AlbumDetail'
import { RecycleBin } from '@/pages/RecycleBin'
import { Settings } from '@/pages/Settings'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <MediaLibrary /> },
      { path: 'persons/:personId', element: <PersonHome /> },
      { path: 'albums/:albumId', element: <AlbumDetail /> },
      { path: 'recycle-bin', element: <RecycleBin /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
])
