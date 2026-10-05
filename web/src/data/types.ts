export type Diet = 'veg' | 'nonveg' | 'unknown';

export interface MenuOption {
  label: string;
  diet: Diet;
  price: number; // rupees
  dbId?: number; // present when the menu came from the API
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  hasVariants?: boolean;
  available?: boolean; // false = sold out today
  dbId?: number;
  options: MenuOption[];
}

export interface MenuCategory {
  id: string;
  name: string;
  color: string;
  kind: 'drink' | 'food';
  min: number;
  max: number;
  items: MenuItem[];
}
