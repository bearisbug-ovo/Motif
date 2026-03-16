import { createBrowserRouter } from 'react-router-dom'
import { Layout } from './layout'
import { MediaLibrary } from '@/pages/MediaLibrary'
import { PersonHome } from '@/pages/PersonHome'
import { AlbumDetail } from '@/pages/AlbumDetail'
import { Settings } from '@/pages/Settings'
import { Workflows } from '@/pages/Workflows'
import { TaskQueue } from '@/pages/TaskQueue'
import { Tools } from '@/pages/Tools'
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <MediaLibrary /> },
      { path: 'persons/:personId', element: <PersonHome /> },
      { path: 'albums/:albumId', element: <AlbumDetail /> },
      { path: 'settings', element: <Settings /> },
      { path: 'tasks', element: <TaskQueue /> },
      { path: 'tools', element: <Tools /> },
      { path: 'workflows', element: <Workflows /> },
    ],
  },
])
