---
layout: post
title: "SQL: An Idiot's Guide"
date: 2024-01-21
categories: ["Code"]
tags: ["sql", "database", "reference"]
description: "SQL, or Structured Query Language, is a programming language designed for managing and manipulating relational databases. It is widely used in the field of database management and is considered a stan"
---
Right, so you want to learn SQL? Good on ya. Look, it's not as scary as it sounds — think of it like talking to a really pedantic librarian who needs you to be very specific about what book you want and where it lives. I've pulled together the basics here in plain English, no fluff, no jargon overload. Grab a cuppa (or something stronger) and let's crack on.


SQL, or Structured Query Language, is a programming language designed for managing and manipulating relational databases. It is widely used in the field of database management and is considered a standard for interacting with relational database systems.

As of now, SQL is extremely common and widely used across various industries and applications. Most relational database management systems (RDBMS), such as MySQL, PostgreSQL, Oracle Database, Microsoft SQL Server, and SQLite, use SQL as their standard query language.

Many web applications, enterprise systems, data analytics platforms, and other software solutions rely on SQL for tasks like data retrieval, insertion, updating, and deletion.

Learning SQL is considered essential for individuals working in fields related to database administration, data analysis, software development, and more.

I will be using this page to distil information for my own usage. Here I will list a brass tacks guide on how to use the language and where I have found use in seeking help.

Two of the most useful sources I have found and have built this post around are:

[Codeacademy cheatsheets](https://www.codecademy.com/resources/cheatsheets/language/sql)

[W3Schools](https://www.w3schools.com/sql/)

## Query Syntax

### `AND` Operator

The `AND` operator allows multiple conditions to be combined. Records must match both conditions that are joined by `AND` to be included in the result set. The given query will match any car that is blue and made after 2014.

```sql
SELECT model
FROM cars
WHERE color = 'blue'
  AND year > 2014;
```

### `AS` Clause

Columns or tables can be aliased using the `AS` clause. This allows columns or tables to be specifically renamed in the returned result set. The given query will return a result set with the column for `name` renamed to `movie_title`.

```sql
SELECT name AS 'movie_title'
FROM movies;
```

### `OR` Operator

The `OR` operator allows multiple conditions to be combined. Records matching either condition joined by the `OR` are included in the result set. The given query will match customers whose state is either `'CA'` or `'NY'`.

```sql
SELECT name
FROM customers
WHERE state = 'CA'
   OR state = 'NY';
```

### `%` Wildcard

The `%` wildcard can be used in a `LIKE` operator pattern to match zero or more unspecified character(s). The given query will match any movie that begins with `The`, followed by zero or more of any characters.

```sql
SELECT name
FROM movies
WHERE name LIKE 'The%';
```

### `SELECT` Statement

The `SELECT *` statement returns all columns from the provided table in the result set. The given query will fetch all columns and records (rows) from the `movies` table.

```sql
SELECT *
FROM movies;
```

### `_` Wildcard

The `_` wildcard can be used in a `LIKE` operator pattern to match any single unspecified character. The given query will match any movie which begins with a single character, followed by `ove`.

```sql
SELECT name
FROM movies
WHERE name LIKE '_ove';
```

### `ORDER BY` Clause

The `ORDER BY` clause can be used to sort the result set by a particular column either alphabetically or numerically. It can be ordered in two ways:

-   `DESC` is a keyword used to sort the results in descending order.
-   `ASC` is a keyword used to sort the results in ascending order (default).

```sql
SELECT *
FROM contacts
ORDER BY birth_date DESC;
```

### `LIKE` Operator

The `LIKE` operator can be used inside of a `WHERE` clause to match a specified pattern. The given query will match any movie that begins with `Star` in its title.

```sql
SELECT name
FROM movies
WHERE name LIKE 'Star%';
```

### `DISTINCT` Clause

Unique values of a column can be selected using a `DISTINCT` query. For a table `contact_details` having five rows in which the `city` column contains Chicago, Madison, Boston, Madison, and Denver, the given query would return:

-   `Chicago`
-   `Madison`
-   `Boston`
-   `Denver`

```sql
SELECT DISTINCT city
FROM contact_details;
```

### `BETWEEN` Operator

The `BETWEEN` operator can be used to filter by a range of values. The range of values can be text, numbers, or date data. The given query will match any movie made between the years 1980 and 1990, inclusive.

```sql
SELECT *
FROM movies
WHERE year BETWEEN 1980 AND 1990;
```

### `LIMIT` Clause

The `LIMIT` clause is used to narrow, or limit, a result set to the specified number of rows. The given query will limit the result set to 5 rows.

```sql
SELECT *
FROM movies
LIMIT 5;
```

### `NULL` Values

Column values can be `NULL`, or have no value. These records can be matched (or not matched) using the `IS NULL` and `IS NOT NULL` operators in combination with the `WHERE` clause. The given query will match all addresses where the address has a value or is not `NULL`.

```sql
SELECT address
FROM records
WHERE address IS NOT NULL;
```

### `WHERE` Clause

The `WHERE` clause is used to filter records (rows) that match a certain condition. The given query will select all records where the `pub_year` equals `2017`.

```sql
SELECT title
FROM library
WHERE pub_year = 2017;
```

## Joining Tables

### Outer Join

An outer join will combine rows from different tables even if the join condition is not met. In a `LEFT JOIN`, every row in the _left_ table is returned in the result set, and if the join condition is not met, then `NULL` values are used to fill in the columns from the _right_ table.

```sql
SELECT column_name(s)
FROM table1
LEFT JOIN table2
  ON table1.column_name = table2.column_name;
```

### `WITH` Clause

The `WITH` clause stores the result of a query in a temporary table (`temporary_movies`) using an alias.

Multiple temporary tables can be defined with one instance of the `WITH` keyword.

```sql
WITH temporary_movies AS (
   SELECT *
   FROM movies
)
SELECT *
FROM temporary_movies
WHERE year BETWEEN 2000 AND 2020;
```

### `UNION` Clause

The `UNION` clause is used to combine results that appear from multiple `SELECT` statements and filter duplicates.

For example, given a `first_names` table with a column `name` containing rows of data “James” and “Hermione”, and a `last_names` table with a column `name` containing rows of data “James”, “Hermione” and “Cassidy”, the result of this query would contain three `name`s: “Cassidy”, “James”, and “Hermione”.

```sql
SELECT name
FROM first_names
UNION
SELECT name
FROM last_names
```

### `CROSS JOIN` Clause

The `CROSS JOIN` clause is used to combine each row from one table with each row from another in the result set. This `JOIN` is helpful for creating all possible combinations for the records (rows) in two tables.

The given query will select the `shirt_color` and `pants_color` columns from the result set, which will contain all combinations of combining the rows in the `shirts` and `pants` tables. If there are 3 different shirt colors in the `shirts` table and 5 different pants colors in the `pants` table then the result set will contain 3 x 5 = 15 rows.

```sql
SELECT shirts.shirt_color,
   pants.pants_color
FROM shirts
CROSS JOIN pants;
```

### Foreign Key

A _foreign key_ is a reference in one table’s records to the primary key of another table. To maintain multiple records for a specific row, the use of foreign key plays a vital role. For instance, to track all the orders of a specific customer, the table `order` (illustrated at the bottom of the image) can contain a foreign key.

![foreign key](https://joshuamein.wordpress.com/wp-content/uploads/2024/01/image.png)

### Primary Key

A _primary key_ column in a SQL table is used to uniquely identify each record in that table. A primary key cannot be `NULL`. In the example, `customer_id` is the primary key. The same value cannot re-occur in a primary key column. Primary keys are often used in `JOIN` operations.

![primary key](https://joshuamein.wordpress.com/wp-content/uploads/2024/01/image-1.png)

### Inner Join

The `JOIN` clause allows for the return of results from more than one table by joining them together with other results based on common column values specified using an `ON` clause. `INNER JOIN` is the default `JOIN` and it will only return results matching the condition specified by `ON`.

```sql
SELECT *
FROM books
JOIN authors
  ON books.author_id = authors.id;
```
---

## Wrapping Up

And that's the gist of it — the core SQL commands you'll actually use day-to-day. Obviously there's loads more depth to dive into (subqueries, window functions, indexing, the whole lot), but if you've got the bits above nailed down, you're in a solid spot. Bookmark this page, come back when you forget something (you will, we all do), and just keep writing queries. The best way to learn is by doing.

Cheers 🍻
