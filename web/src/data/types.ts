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
  /** A photo of the dish (uploaded in the admin), if there is one. */
  imageUrl?: string;
  hasVariants?: boolean;
  available?: boolean; // false = sold out today
  dbId?: number;
  /** Ingredient ids (see `Ingredient`), set in Admin, Menu. Empty when nobody has added them. */
  ingredients?: number[];
  options: MenuOption[];
}

/** An ingredient or allergen a guest can leave out of the menu. */
export interface Ingredient {
  id: number;
  name: string;
  allergen: boolean;
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
