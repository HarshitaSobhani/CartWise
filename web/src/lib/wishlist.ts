import { api, errorMessage } from './api';

/** Adds a product to the user's first wishlist (the default "My wishlist"). Returns a user-facing message. */
export async function addToDefaultWishlist(productId: string): Promise<string> {
  try {
    const { wishlists } = await api<{ wishlists: { id: string; name: string }[] }>('/me/wishlists');
    if (!wishlists.length) return 'Create a wishlist first.';
    await api(`/me/wishlists/${wishlists[0].id}/items`, { method: 'POST', body: { productId } });
    return `Added to “${wishlists[0].name}”.`;
  } catch (e) {
    return errorMessage(e);
  }
}
