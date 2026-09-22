import { requireAdmin } from '../../utils/auth'
import { loadSmsSettings } from '../../utils/smsSettings'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  return await loadSmsSettings()
})
