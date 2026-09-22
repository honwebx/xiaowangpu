import type { Role } from '~~/types'
import {
  HomeOutline,
  CartOutline,
  CubeOutline,
  PeopleOutline,
  PersonOutline,
  StorefrontOutline,
  SettingsOutline,
} from '@vicons/ionicons5'

export interface MenuItemDef {
  label: string
  key: string
  icon: any
  roles: Role[]
}

export const MENU_DEFS: MenuItemDef[] = [
  { label: '首页', key: '/', icon: HomeOutline, roles: ['admin', 'manager', 'clerk'] },
  { label: '收银', key: '/pos', icon: CartOutline, roles: ['admin', 'manager', 'clerk'] },
  { label: '商品', key: '/products', icon: CubeOutline, roles: ['admin', 'manager', 'clerk'] },
  { label: '会员', key: '/members', icon: PeopleOutline, roles: ['admin', 'manager', 'clerk'] },
  { label: '店员', key: '/staff', icon: PersonOutline, roles: ['admin', 'manager'] },
  { label: '店铺', key: '/stores', icon: StorefrontOutline, roles: ['admin'] },
  { label: '设置', key: '/settings', icon: SettingsOutline, roles: ['admin', 'manager'] },
]

export const ROUTE_RESTRICTIONS: { prefix: string; allow: Role[] }[] = [
  { prefix: '/staff', allow: ['admin', 'manager'] },
  { prefix: '/stores', allow: ['admin'] },
  { prefix: '/settings', allow: ['admin', 'manager'] },
]
