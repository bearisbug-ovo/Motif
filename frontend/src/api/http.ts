import axios from 'axios'

const http = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

export default http
