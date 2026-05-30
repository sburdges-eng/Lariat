export const NextResponse = {
  next() {
    return new Response(null, { status: 200 });
  },
  redirect(url, status = 307) {
    return Response.redirect(url, status);
  },
  json(body, init) {
    return Response.json(body, init);
  },
};
