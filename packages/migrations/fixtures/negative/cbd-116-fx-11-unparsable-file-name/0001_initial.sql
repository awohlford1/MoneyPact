-- CBD-116-FX-11. A sequential counter rather than a UTC ordinal: the naming
-- scheme that makes two parallel branches both pick 0002.
ALTER TABLE platform_thing ADD COLUMN gamma integer;
